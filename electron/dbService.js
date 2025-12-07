const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

// globalDb: config-level data (e.g. orbit_current_user) using KV
// userDb: per-user data (messages, conversations, contacts, etc.) using real tables

class DbService {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.dbDir = path.join(this.userDataPath, 'db');

    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    // Global config DB
    const globalPath = path.join(this.dbDir, 'config.db');
    this.globalDb = new Database(globalPath);
    this.ensureKvTable(this.globalDb);

    // Current user DB (opened on auth:login)
    this.userDb = null;
  }

  ensureKvTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      valueJson TEXT
    );`);
  }

  // ---- Global (config) operations ----

  getGlobal(key) {
    const row = this.globalDb.prepare('SELECT valueJson FROM kv_store WHERE key = ?').get(key);
    if (!row || row.valueJson == null) return null;
    try {
      return JSON.parse(row.valueJson);
    } catch {
      return null;
    }
  }

  setGlobal(key, value) {
    const valueJson = JSON.stringify(value);
    this.globalDb
      .prepare('INSERT INTO kv_store(key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson')
      .run(key, valueJson);
  }

  // ---- User DB lifecycle ----

  openUserDb(fileName) {
    const filePath = path.join(this.dbDir, `${fileName}.db`);
    if (this.userDb) {
      try { this.userDb.close(); } catch (_) {}
      this.userDb = null;
    }
    this.userDb = new Database(filePath);
    this.initUserSchema(this.userDb);
  }

  closeUserDb() {
    if (this.userDb) {
      try { this.userDb.close(); } catch (_) {}
      this.userDb = null;
    }
  }

  // ---- User KV operations ----

  getUser(key) {
    if (!this.userDb) return null;
    const row = this.userDb.prepare('SELECT valueJson FROM kv_store WHERE key = ?').get(key);
    if (!row || row.valueJson == null) return null;
    try {
      return JSON.parse(row.valueJson);
    } catch {
      return null;
    }
  }

  setUser(key, value) {
    if (!this.userDb) return false;
    const valueJson = JSON.stringify(value);
    this.userDb
      .prepare('INSERT INTO kv_store(key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson')
      .run(key, valueJson);
    return true;
  }

  clearUser() {
    if (!this.userDb) return;
    this.userDb.exec('DELETE FROM messages;');
    this.userDb.exec('DELETE FROM conversations;');
    this.userDb.exec('DELETE FROM contacts;');
    this.userDb.exec('DELETE FROM friend_requests;');
    this.userDb.exec('DELETE FROM settings;');
  }

  // ---- User relational schema & high-level operations ----

  initUserSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT,
        senderId TEXT,
        content TEXT,
        type TEXT,
        status TEXT,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        participantId TEXT,
        unreadCount INTEGER DEFAULT 0,
        updatedAt INTEGER,
        lastMessageId TEXT
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        username TEXT,
        avatarUrl TEXT,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fromUserId TEXT,
        payloadJson TEXT,
        createdAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        valueJson TEXT
      );
    `);
  }

  // Settings
  getSettings() {
    if (!this.userDb) return {};
    const rows = this.userDb.prepare('SELECT key, valueJson FROM settings').all();
    const out = {};
    for (const r of rows) {
      try { out[r.key] = JSON.parse(r.valueJson); } catch { out[r.key] = null; }
    }
    return out;
  }

  setSettingsKey(key, value) {
    if (!this.userDb) return false;
    const valueJson = JSON.stringify(value);
    this.userDb.prepare(
      'INSERT INTO settings(key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson'
    ).run(key, valueJson);
    return true;
  }

  // Contacts
  getContacts() {
    if (!this.userDb) return [];
    return this.userDb.prepare('SELECT id, username, avatarUrl, status FROM contacts').all();
  }

  setContacts(contacts) {
    if (!this.userDb) return false;
    const insert = this.userDb.prepare(
      'INSERT INTO contacts(id, username, avatarUrl, status) VALUES (@id, @username, @avatarUrl, @status) '
      + 'ON CONFLICT(id) DO UPDATE SET username = excluded.username, avatarUrl = excluded.avatarUrl, status = excluded.status'
    );
    const clear = this.userDb.prepare('DELETE FROM contacts;');
    const tx = this.userDb.transaction((list) => {
      clear.run();
      for (const c of list) insert.run(c);
    });
    tx(contacts || []);
    return true;
  }

  // Friend requests stored as opaque payloads keyed by fromUserId
  getFriendRequests() {
    if (!this.userDb) return [];
    const rows = this.userDb.prepare('SELECT id, fromUserId, payloadJson, createdAt FROM friend_requests ORDER BY createdAt ASC').all();
    return rows.map(r => {
      try {
        return JSON.parse(r.payloadJson);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  upsertFriendRequest(request) {
    if (!this.userDb) return false;
    const payloadJson = JSON.stringify(request);
    // Ensure only one per fromUserId
    const del = this.userDb.prepare('DELETE FROM friend_requests WHERE fromUserId = ?');
    const ins = this.userDb.prepare(
      'INSERT INTO friend_requests(fromUserId, payloadJson, createdAt) VALUES (?, ?, ?)' 
    );
    const now = Date.now();
    const tx = this.userDb.transaction(() => {
      del.run(request.fromUser.id);
      ins.run(request.fromUser.id, payloadJson, now);
    });
    tx();
    return true;
  }

  removeFriendRequestByUserId(userId) {
    if (!this.userDb) return false;
    this.userDb.prepare('DELETE FROM friend_requests WHERE fromUserId = ?').run(userId);
    return true;
  }

  // Messages & conversations
  getMessagesByConversation(conversationId) {
    if (!this.userDb) return [];
    return this.userDb.prepare(
      'SELECT id, conversationId, senderId, content, type, status, timestamp FROM messages WHERE conversationId = ? ORDER BY timestamp ASC'
    ).all(conversationId);
  }

  getMessageById(id) {
    if (!this.userDb) return null;
    return this.userDb.prepare(
      'SELECT id, conversationId, senderId, content, type, status, timestamp FROM messages WHERE id = ?'
    ).get(id) || null;
  }

  upsertMessage(message) {
    if (!this.userDb) return false;
    const stmt = this.userDb.prepare(
      'INSERT INTO messages(id, conversationId, senderId, content, type, status, timestamp) '
      + 'VALUES (@id, @conversationId, @senderId, @content, @type, @status, @timestamp) '
      + 'ON CONFLICT(id) DO UPDATE SET conversationId = excluded.conversationId, senderId = excluded.senderId, '
      + 'content = excluded.content, type = excluded.type, status = excluded.status, timestamp = excluded.timestamp'
    );
    stmt.run(message);
    return true;
  }
  
  // For compatibility: replace entire messages table from array
  replaceAllMessages(messages) {
    if (!this.userDb) return false;
    const clear = this.userDb.prepare('DELETE FROM messages;');
    const insert = this.userDb.prepare(
      'INSERT INTO messages(id, conversationId, senderId, content, type, status, timestamp) '
      + 'VALUES (@id, @conversationId, @senderId, @content, @type, @status, @timestamp)'
    );
    const tx = this.userDb.transaction((list) => {
      clear.run();
      for (const m of list || []) insert.run(m);
    });
    tx(messages || []);
    return true;
  }

  getAllMessages() {
    if (!this.userDb) return [];
    return this.userDb.prepare('SELECT id, conversationId, senderId, content, type, status, timestamp FROM messages').all();
  }

  getConversations() {
    if (!this.userDb) return [];
    // We keep lastMessage as a separate fetch in renderer for now; store only id
    return this.userDb.prepare(
      'SELECT id, participantId, unreadCount, updatedAt, lastMessageId FROM conversations ORDER BY updatedAt DESC'
    ).all();
  }

   // For compatibility: replace entire conversations table from array
  replaceAllConversations(convos) {
    if (!this.userDb) return false;
    const clear = this.userDb.prepare('DELETE FROM conversations;');
    const insert = this.userDb.prepare(
      'INSERT INTO conversations(id, participantId, unreadCount, updatedAt, lastMessageId) '
      + 'VALUES (@id, @participantId, @unreadCount, @updatedAt, @lastMessageId)'
    );
    const tx = this.userDb.transaction((list) => {
      clear.run();
      for (const c of list || []) insert.run({
        id: c.id,
        participantId: c.participantId,
        unreadCount: c.unreadCount ?? 0,
        updatedAt: c.updatedAt ?? 0,
        lastMessageId: c.lastMessage?.id || null,
      });
    });
    tx(convos || []);
    return true;
  }

  upsertConversation(convo) {
    if (!this.userDb) return false;
    const stmt = this.userDb.prepare(
      'INSERT INTO conversations(id, participantId, unreadCount, updatedAt, lastMessageId) '
      + 'VALUES (@id, @participantId, @unreadCount, @updatedAt, @lastMessageId) '
      + 'ON CONFLICT(id) DO UPDATE SET participantId = excluded.participantId, unreadCount = excluded.unreadCount, '
      + 'updatedAt = excluded.updatedAt, lastMessageId = excluded.lastMessageId'
    );
    stmt.run(convo);
    return true;
  }

  deleteConversationByParticipant(participantId) {
    if (!this.userDb) return false;
    this.userDb.prepare('DELETE FROM conversations WHERE participantId = ?').run(participantId);
    return true;
  }
}

module.exports = new DbService();
