
import { Message, Conversation, User, AppSettings, FriendRequest } from '../types';
import { INITIAL_CONTACTS } from '../constants';
import { logger } from './logger';

const KEY_MESSAGES = 'orbit_messages';
const KEY_CONVERSATIONS = 'orbit_conversations';
const KEY_SETTINGS = 'orbit_settings';
const KEY_CONTACTS = 'orbit_contacts';
const KEY_CURRENT_USER = 'orbit_current_user';
const KEY_FRIEND_REQUESTS = 'orbit_friend_requests';

class StorageService {
  private isElectron: boolean;
  private currentUserId: string | null = null;
  private cachedUser: User | null = null;
  // Simple per-key async locks to avoid read-modify-write races
  private locks: Map<string, Promise<void>> = new Map();

  constructor() {
    this.isElectron = typeof window.electronAPI !== 'undefined';
  }

  // --- Core Storage Logic ---

  private getStorageKey(key: string): string {
    // Electron Logic:
    if (this.isElectron) return key;

    // Browser Logic:
    if (key === KEY_CURRENT_USER) return key; // Global key
    if (this.currentUserId) return `${this.currentUserId}_${key}`; // User specific
    return key; // Fallback
  }

  private async getItem<T>(key: string): Promise<T | null> {
    const finalKey = this.getStorageKey(key);
    
    if (this.isElectron) {
      return await window.electronAPI!.invoke('db:get', key); // Send raw key, Main handles routing
    } else {
      const data = localStorage.getItem(finalKey);
      return data ? JSON.parse(data) : null;
    }
  }

  private async setItem(key: string, value: any): Promise<void> {
    const finalKey = this.getStorageKey(key);

    if (this.isElectron) {
      await window.electronAPI!.invoke('db:set', { key, value });
    } else {
      localStorage.setItem(finalKey, JSON.stringify(value));
    }
  }

  // Execute fn sequentially per storage key to prevent race conditions
  private async withLock(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(key) || Promise.resolve();
    // chain the operations
    const next = prev.then(() => fn());
    // store a settled promise to keep chain
    this.locks.set(key, next.catch(() => {}));
    return next;
  }
  
  async init(): Promise<void> {
    logger.info('Storage', `Initializing storage... Mode: ${this.isElectron ? 'Electron' : 'Browser'}`);
    
    // Protection: If we already have a session in memory, do not re-read from global store.
    if (this.currentUserId) return;
    
    // 1. Check Global Store for last logged in user
    // In Electron, db:get(KEY_CURRENT_USER) hits globalStore
    const user = await this.getItem<User>(KEY_CURRENT_USER);
    
    if (user) {
        logger.info('Storage', `Found existing session for: ${user.username} (${user.id})`);
        this.currentUserId = user.id;
        this.cachedUser = user;
        
        if (this.isElectron) {
            // Tell Main process to switch to this user's DB file
            await window.electronAPI!.invoke('auth:login', user.id);
        }
    }
    
    // 2. Seed data (This will now go into User Store if logged in)
    const existingContacts = await this.getItem(KEY_CONTACTS);
    if (!existingContacts && !this.isElectron) { 
       // Only seed if empty. In Electron we assume empty file means new user.
       await this.setItem(KEY_CONTACTS, INITIAL_CONTACTS);
    }
  }

  // --- Auth & Session ---

  async getCurrentUser(): Promise<User | null> {
    // Memory Cache First
    if (this.cachedUser) return this.cachedUser;
    
    const user = await this.getItem<User>(KEY_CURRENT_USER);
    if (user) this.cachedUser = user;
    return user;
  }
  
  // NEW: Get last user without triggering a "login" state in this service instance
  async getLastUser(): Promise<User | null> {
      if (this.isElectron) {
          return await window.electronAPI!.invoke('db:get', KEY_CURRENT_USER);
      } else {
          const data = localStorage.getItem(KEY_CURRENT_USER);
          return data ? JSON.parse(data) : null;
      }
  }

  async setCurrentUser(user: User): Promise<void> {
    this.cachedUser = user;
    
    // 1. Save global "Last User" ref (persists for next login)
    await this.setItem(KEY_CURRENT_USER, user);
    
    // 2. Switch Context
    this.currentUserId = user.id;
    
    if (this.isElectron) {
        await window.electronAPI!.invoke('auth:login', user.id);
    }
    
    // 3. Re-seed contacts if empty
    const contacts = await this.getContacts();
    if (!contacts || contacts.length === 0) {
        await this.setItem(KEY_CONTACTS, INITIAL_CONTACTS);
    }
  }

  async logout(): Promise<void> {
      if (this.isElectron) {
          await window.electronAPI!.invoke('auth:logout');
      }
      this.currentUserId = null;
      this.cachedUser = null;
      // Note: We DO NOT clear KEY_CURRENT_USER. This allows "Remember Me" / pre-fill on login page.
  }

  // --- Friend Requests ---

  async getFriendRequests(): Promise<FriendRequest[]> {
    return (await this.getItem<FriendRequest[]>(KEY_FRIEND_REQUESTS)) || [];
  }

  async addFriendRequest(request: FriendRequest): Promise<void> {
    const requests = await this.getFriendRequests();
    // Avoid duplicates
    if (!requests.find(r => r.fromUser.id === request.fromUser.id)) {
      requests.push(request);
      await this.setItem(KEY_FRIEND_REQUESTS, requests);
    }
  }

  async removeFriendRequest(userId: string): Promise<void> {
    let requests = await this.getFriendRequests();
    requests = requests.filter(r => r.fromUser.id !== userId);
    await this.setItem(KEY_FRIEND_REQUESTS, requests);
  }

  // --- Contacts ---

  async getContacts(): Promise<User[]> {
    return (await this.getItem<User[]>(KEY_CONTACTS)) || [];
  }

  async addContact(contact: User): Promise<void> {
    const contacts = await this.getContacts();
    if (!contacts.find(c => c.id === contact.id)) {
        contacts.push(contact);
        await this.setItem(KEY_CONTACTS, contacts);
    }
  }

  async removeContact(contactId: string): Promise<void> {
    let contacts = await this.getContacts();
    contacts = contacts.filter(c => c.id !== contactId);
    await this.setItem(KEY_CONTACTS, contacts);
  }

  // --- Conversations ---

  async getConversations(): Promise<Conversation[]> {
    // In Electron, main.js already returns sorted conversations
    const convos = (await this.getItem<Conversation[]>(KEY_CONVERSATIONS)) || [];
    return convos.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async removeConversationByParticipantId(participantId: string): Promise<void> {
    if (this.isElectron) {
      await window.electronAPI!.invoke('db:convo-delete-by-participant', participantId);
    } else {
      let convos = await this.getConversations();
      convos = convos.filter(c => c.participantId !== participantId);
      await this.setItem(KEY_CONVERSATIONS, convos);
    }
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (this.isElectron) {
      const msgs = await window.electronAPI!.invoke('db:messages-by-conversation', conversationId) as Message[];
      return (msgs || []).sort((a, b) => a.timestamp - b.timestamp);
    }
    const allMessages = (await this.getItem<Message[]>(KEY_MESSAGES)) || [];
    return allMessages
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      const currentUser = await this.getCurrentUser();

      if (this.isElectron) {
        await window.electronAPI!.invoke('db:message-upsert', message);
        if (currentUser) {
          await window.electronAPI!.invoke('db:conversation-update-last', {
            conversationId: message.conversationId,
            message,
            currentUserId: currentUser.id,
          });
        }
        return;
      }

      // Browser fallback: keep legacy array semantics
      await this.withLock(KEY_MESSAGES, async () => {
        const allMessages = (await this.getItem<Message[]>(KEY_MESSAGES)) || [];
        const idx = allMessages.findIndex(m => m.id === message.id);
        if (idx >= 0) {
          allMessages[idx] = message;
        } else {
          allMessages.push(message);
        }
        await this.setItem(KEY_MESSAGES, allMessages);
      });

      if (currentUser) {
        await this.withLock(KEY_CONVERSATIONS, async () => {
          await this.updateConversationLastMessageLegacy(message.conversationId, message, currentUser.id);
        });
      }
    } catch (e) {
      logger.error('Storage', 'Failed to save message', e);
      throw e;
    }
  }

  private async updateConversationLastMessageLegacy(conversationId: string, message: Message, currentUserId: string) {
    const convos = await this.getConversations();
    const index = convos.findIndex(c => c.id === conversationId);
    
    if (index >= 0) {
      convos[index].lastMessage = message;
      convos[index].updatedAt = message.timestamp;
      if (message.senderId !== currentUserId) {
         convos[index].unreadCount += 1;
      }
      await this.setItem(KEY_CONVERSATIONS, convos);
    } else {
      const newConvo: Conversation = {
        id: conversationId,
        participantId: message.senderId === currentUserId ? 'user_002' : message.senderId,
        unreadCount: message.senderId !== currentUserId ? 1 : 0,
        lastMessage: message,
        updatedAt: message.timestamp
      };
      
      if (message.senderId !== currentUserId) {
          newConvo.participantId = message.senderId;
      }

      convos.push(newConvo);
      await this.setItem(KEY_CONVERSATIONS, convos);
    }
  }

  async createConversation(participantId: string): Promise<string> {
      const currentUser = await this.getCurrentUser();
      if (!currentUser) throw new Error("No user logged in");

      if (this.isElectron) {
        return await window.electronAPI!.invoke('db:conversation-create', { participantId, currentUserId: currentUser.id });
      }

      // Browser fallback
      const convos = await this.getConversations();
      const existing = convos.find(c => c.participantId === participantId);
      if (existing) return existing.id;

      const ids = [currentUser.id, participantId].sort();
      const newId = `convo_${ids[0]}_${ids[1]}`;

      const newConvo: Conversation = {
          id: newId,
          participantId,
          unreadCount: 0,
          updatedAt: Date.now()
      };

      convos.push(newConvo);
      await this.setItem(KEY_CONVERSATIONS, convos);
      return newId;
  }

  async markConversationRead(conversationId: string): Promise<void> {
    if (this.isElectron) {
      await window.electronAPI!.invoke('db:conversation-mark-read', conversationId);
      return;
    }

    const convos = await this.getConversations();
    const index = convos.findIndex(c => c.id === conversationId);
    if (index >= 0) {
      convos[index].unreadCount = 0;
      await this.setItem(KEY_CONVERSATIONS, convos);
    }
  }

  async getSettings(): Promise<AppSettings> {
    const defaults: AppSettings = { 
      theme: 'light', 
      notificationsEnabled: true, 
      logLevel: 'info',
      // serverHost/Port left undefined by default; UI can supply or use env/defaults
    } as AppSettings;
    const data = await this.getItem<AppSettings>(KEY_SETTINGS);
    return data ? { ...defaults, ...data } : defaults;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.setItem(KEY_SETTINGS, settings);
  }
  
  async clearAll(): Promise<void> {
    if(this.isElectron) {
      await window.electronAPI?.invoke('db:clear');
    } else {
      localStorage.clear();
    }
  }
}

export const storageService = new StorageService();
