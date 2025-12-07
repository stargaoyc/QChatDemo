
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dns = require('dns');
const fileService = require('./fileService');
const dbService = require('./dbService');

// Global reference to prevent garbage collection
let mainWindow;

// 1. Native check for Dev environment
const isDev = !app.isPackaged;

async function initialize() {
  try {
    // SQLite dbService is required synchronously above; nothing else to init here
    createWindow();
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !isDev, 
    },
    titleBarStyle: 'hiddenInset', 
    autoHideMenuBar: true, 
    show: false, 
    backgroundColor: '#f8fafc',
    title: `QChat${isDev ? ' (DEV)' : ''}`
  });

  const startURL = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startURL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// App Lifecycle
app.whenReady().then(initialize);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers (Backend Logic) ---

// Auth: Switch Storage File (SQLite per-user DB)
ipcMain.handle('auth:login', (event, userId) => {
  if (!userId) return false;

  const safeId = userId.replace(/[^a-z0-9_-]/gi, '_');
  const fileName = `user_${safeId}${isDev ? '_dev' : ''}`;

  console.log(`[Main] Switching storage to SQLite DB: ${fileName}`);
  dbService.openUserDb(fileName);
  return true;
});

ipcMain.handle('auth:logout', () => {
  console.log('[Main] Logging out, closing user DB');
  dbService.closeUserDb();
  return true;
});

// Get Data
ipcMain.handle('db:get', (event, key) => {
  if (key === 'orbit_current_user') {
    return dbService.getGlobal(key);
  }

  // Per-user structured data
  if (key === 'orbit_settings') {
    return dbService.getSettings();
  }
  if (key === 'orbit_contacts') {
    return dbService.getContacts();
  }
  if (key === 'orbit_friend_requests') {
    return dbService.getFriendRequests();
  }
    if (key === 'orbit_messages') {
      // Return all messages for compatibility (renderer will filter by conversationId)
      return dbService.getAllMessages();
    }
    if (key === 'orbit_conversations') {
        // Reconstruct as array including lastMessage object, if resolvable
        const convos = dbService.getConversations();
        const allMessages = dbService.getAllMessages();
        const byId = new Map();
        for (const m of allMessages) {
          byId.set(m.id, m);
        }
        return convos.map(c => ({
          id: c.id,
          participantId: c.participantId,
          unreadCount: c.unreadCount ?? 0,
          updatedAt: c.updatedAt ?? 0,
          lastMessage: c.lastMessageId ? byId.get(c.lastMessageId) || null : null,
        }));
    }

  // Fallback for unstructured keys (not expected now)
  const userVal = dbService.getUser(key);
  if (userVal !== null && userVal !== undefined) return userVal;
  return dbService.getGlobal(key);
});

// Set Data
ipcMain.handle('db:set', (event, { key, value }) => {
  if (key === 'orbit_current_user') {
    dbService.setGlobal(key, value);
    return true;
  }
  if (key === 'orbit_settings') {
    dbService.setSettingsKey('app', value);
    return true;
  }
  if (key === 'orbit_contacts') {
    dbService.setContacts(value || []);
    return true;
  }
  if (key === 'orbit_friend_requests') {
    // storageService 目前是整表覆盖或按单条操作，这里只支持整表覆盖场景
    // 为简单起见，这里直接清空并逐条 upsert
    if (Array.isArray(value)) {
      value.forEach(req => dbService.upsertFriendRequest(req));
    }
    return true;
  }
    if (key === 'orbit_messages') {
      dbService.replaceAllMessages(value || []);
      return true;
    }
    if (key === 'orbit_conversations') {
      dbService.replaceAllConversations(value || []);
      return true;
    }

  const ok = dbService.setUser(key, value);
  if (ok) return true;

  dbService.setGlobal(key, value);
  return true;
});

// Clear Data
ipcMain.handle('db:clear', async () => {
  // 1. Find all images belonging to this user from messages in SQLite
  const allMessages = dbService.getMessagesByConversation ? dbService.getAllMessages?.() : [];
  const imageFiles = Array.isArray(allMessages)
    ? allMessages
      .filter(m => m && m.type === 'IMAGE' && m.content && typeof m.content === 'string' && !m.content.startsWith('data:'))
      .map(m => m.content)
    : [];

  if (imageFiles.length > 0) {
    await fileService.deleteFiles(imageFiles);
  }

  // 2. Clear KV store for this user
  dbService.clearUser();

  return true;
});

// Fine-grained DB operations for Electron renderer
ipcMain.handle('db:messages-by-conversation', (event, conversationId) => {
  return dbService.getMessagesByConversation(conversationId);
});

ipcMain.handle('db:message-upsert', (event, message) => {
  dbService.upsertMessage(message);
  return true;
});

ipcMain.handle('db:conversation-update-last', (event, { conversationId, message, currentUserId }) => {
  const convos = dbService.getConversations();
  let convo = convos.find(c => c.id === conversationId) || null;

  if (convo) {
    const unreadInc = message.senderId !== currentUserId ? 1 : 0;
    convo = {
      ...convo,
      lastMessageId: message.id,
      updatedAt: message.timestamp,
      unreadCount: (convo.unreadCount || 0) + unreadInc,
    };
  } else {
    const participantId = message.senderId === currentUserId ? 'user_002' : message.senderId;
    convo = {
      id: conversationId,
      participantId,
      unreadCount: message.senderId !== currentUserId ? 1 : 0,
      updatedAt: message.timestamp,
      lastMessageId: message.id,
    };
  }

  dbService.upsertConversation(convo);
  return true;
});

ipcMain.handle('db:conversation-create', (event, { participantId, currentUserId }) => {
  const convos = dbService.getConversations();
  const existing = convos.find(c => c.participantId === participantId);
  if (existing) return existing.id;

  const ids = [currentUserId, participantId].sort();
  const newId = `convo_${ids[0]}_${ids[1]}`;
  const now = Date.now();

  dbService.upsertConversation({
    id: newId,
    participantId,
    unreadCount: 0,
    updatedAt: now,
    lastMessageId: null,
  });

  return newId;
});

ipcMain.handle('db:conversation-mark-read', (event, conversationId) => {
  const convos = dbService.getConversations();
  const existing = convos.find(c => c.id === conversationId);
  if (!existing) return true;
  existing.unreadCount = 0;
  dbService.upsertConversation(existing);
  return true;
});

ipcMain.handle('db:convo-delete-by-participant', (event, participantId) => {
  dbService.deleteConversationByParticipant(participantId);
  return true;
});

// Quit App
ipcMain.handle('app:quit', () => {
    app.quit();
});

// DNS Resolution
ipcMain.handle('net:resolve-dns', async (event, hostname) => {
    return new Promise((resolve) => {
        dns.lookup(hostname, { family: 4 }, (err, address) => {
            if (err) {
                console.error(`[Main] DNS lookup failed for ${hostname}:`, err);
                resolve(null);
            } else {
                console.log(`[Main] DNS resolved ${hostname} -> ${address}`);
                resolve(address);
            }
        });
    });
});

// File System Handlers
ipcMain.handle('file:save-image', async (event, base64Data) => {
    return await fileService.saveImage(base64Data);
});

ipcMain.handle('file:read-image', async (event, filename) => {
    return await fileService.readImage(filename);
});
