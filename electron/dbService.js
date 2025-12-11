const path = require("path");
const fs = require("fs");
const { app } = require("electron");
require("reflect-metadata");
const { DataSource } = require("typeorm");
const {
  KvEntity,
  MessageEntity,
  ConversationEntity,
  ContactEntity,
  FriendRequestEntity,
  SettingEntity,
} = require("./entities");

class DbService {
  constructor(electronApp, dataSourceClass) {
    const appToUse = electronApp || app;
    this.DataSource = dataSourceClass || DataSource;
    if (!appToUse) {
      console.warn("DbService initialized without electron app");
      return;
    }
    this.userDataPath = appToUse.getPath("userData");
    this.dbDir = path.join(this.userDataPath, "db");
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    this.globalPath = path.join(this.dbDir, "config.db");
    this.globalDataSource = null;
    this.userDataSource = null;
  }

  async initGlobal() {
    if (this.globalDataSource && this.globalDataSource.isInitialized) {
      return;
    }
    this.globalDataSource = new this.DataSource({
      type: "better-sqlite3",
      database: this.globalPath,
      entities: [KvEntity],
      synchronize: true,
    });
    await this.globalDataSource.initialize();
  }

  async getGlobalRepo() {
    await this.initGlobal();
    try {
      return this.globalDataSource.getRepository(KvEntity);
    } catch (err) {
      // If metadata is somehow missing, re-init and retry to avoid runtime failures
      await this.globalDataSource.destroy().catch(() => {});
      this.globalDataSource = null;
      await this.initGlobal();
      return this.globalDataSource.getRepository(KvEntity);
    }
  }

  async getGlobal(key) {
    const repo = await this.getGlobalRepo();
    const row = await repo.findOneBy({ key });
    if (!row || row.valueJson == null) return null;
    try {
      return JSON.parse(row.valueJson);
    } catch {
      return null;
    }
  }

  async setGlobal(key, value) {
    const repo = await this.getGlobalRepo();
    const valueJson = JSON.stringify(value);
    await repo.save({ key, valueJson });
  }

  async openUserDb(fileName) {
    const filePath = path.join(this.dbDir, `${fileName}.db`);
    if (this.userDataSource && this.userDataSource.isInitialized) {
      await this.userDataSource.destroy().catch(() => {});
      this.userDataSource = null;
    }
    this.userDataSource = new this.DataSource({
      type: "better-sqlite3",
      database: filePath,
      entities: [
        KvEntity,
        MessageEntity,
        ConversationEntity,
        ContactEntity,
        FriendRequestEntity,
        SettingEntity,
      ],
      synchronize: true,
    });
    await this.userDataSource.initialize();
  }

  // Generic per-user KV (compatibility fallback)
  async getUser(key) {
    if (!this.userDataSource) return null;
    const repo = this.userDataSource.getRepository(KvEntity);
    const row = await repo.findOneBy({ key });
    if (!row || row.valueJson == null) return null;
    try {
      return JSON.parse(row.valueJson);
    } catch {
      return null;
    }
  }

  async setUser(key, value) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(KvEntity);
    const valueJson = JSON.stringify(value);
    await repo.save({ key, valueJson });
    return true;
  }

  async closeUserDb() {
    if (this.userDataSource && this.userDataSource.isInitialized) {
      await this.userDataSource.destroy().catch(() => {});
    }
    this.userDataSource = null;
  }

  ensureUserDb() {
    if (!this.userDataSource || !this.userDataSource.isInitialized) {
      throw new Error("User DB not initialized");
    }
  }

  // Settings
  async getSettings() {
    if (!this.userDataSource) return {};
    const repo = this.userDataSource.getRepository(SettingEntity);
    const rows = await repo.find();
    const out = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.valueJson);
      } catch {
        out[r.key] = null;
      }
    }
    return out;
  }

  async setSettingsKey(key, value) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(SettingEntity);
    const valueJson = JSON.stringify(value);
    await repo.save({ key, valueJson });
    return true;
  }

  // Contacts
  async getContacts() {
    if (!this.userDataSource) return [];
    const repo = this.userDataSource.getRepository(ContactEntity);
    return await repo.find();
  }

  async setContacts(contacts) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(ContactEntity);
    await repo.clear();
    if (contacts && contacts.length) {
      await repo.save(contacts);
    }
    return true;
  }

  // Friend requests
  async getFriendRequests() {
    if (!this.userDataSource) return [];
    const repo = this.userDataSource.getRepository(FriendRequestEntity);
    const rows = await repo.find({ order: { createdAt: "ASC" } });
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payloadJson);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async upsertFriendRequest(request) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(FriendRequestEntity);
    await repo.delete({ fromUserId: request.fromUser.id });
    const payloadJson = JSON.stringify(request);
    await repo.save({ fromUserId: request.fromUser.id, payloadJson, createdAt: Date.now() });
    return true;
  }

  async removeFriendRequestByUserId(userId) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(FriendRequestEntity);
    await repo.delete({ fromUserId: userId });
    return true;
  }

  // Messages
  async getMessagesByConversation(conversationId) {
    if (!this.userDataSource) return [];
    const repo = this.userDataSource.getRepository(MessageEntity);
    return await repo.find({ where: { conversationId }, order: { timestamp: "ASC" } });
  }

  async getAllMessages() {
    if (!this.userDataSource) return [];
    const repo = this.userDataSource.getRepository(MessageEntity);
    return await repo.find();
  }

  async upsertMessage(message) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(MessageEntity);
    await repo.save(message);
    return true;
  }

  async replaceAllMessages(messages) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(MessageEntity);
    await repo.clear();
    if (messages && messages.length) {
      await repo.save(messages);
    }
    return true;
  }

  // Conversations
  async getConversations() {
    if (!this.userDataSource) return [];
    const repo = this.userDataSource.getRepository(ConversationEntity);
    return await repo.find({ order: { updatedAt: "DESC" } });
  }

  async replaceAllConversations(convos) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(ConversationEntity);
    await repo.clear();
    if (convos && convos.length) {
      const normalized = convos.map((c) => ({
        id: c.id,
        participantId: c.participantId,
        unreadCount: c.unreadCount ?? 0,
        updatedAt: c.updatedAt ?? 0,
        lastMessageId: c.lastMessage?.id || c.lastMessageId || null,
      }));
      await repo.save(normalized);
    }
    return true;
  }

  async upsertConversation(convo) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(ConversationEntity);
    await repo.save(convo);
    return true;
  }

  async deleteConversationByParticipant(participantId) {
    this.ensureUserDb();
    const repo = this.userDataSource.getRepository(ConversationEntity);
    await repo.delete({ participantId });
    return true;
  }

  // Clear chat data only (messages + conversations)
  async clearUserChatsOnly() {
    if (!this.userDataSource) return;
    const msgRepo = this.userDataSource.getRepository(MessageEntity);
    const convoRepo = this.userDataSource.getRepository(ConversationEntity);
    await msgRepo.clear();
    await convoRepo.clear();
  }
}

module.exports = new DbService();
module.exports.DbService = DbService;
