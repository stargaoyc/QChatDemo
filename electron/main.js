
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
ipcMain.handle('auth:login', async (event, userId) => {
  if (!userId) return false;

  const safeId = userId.replace(/[^a-z0-9_-]/gi, '_');
  const fileName = `user_${safeId}${isDev ? '_dev' : ''}`;

  console.log(`[Main] Switching storage to SQLite DB: ${fileName}`);
  await dbService.openUserDb(fileName);
  return true;
});

ipcMain.handle('auth:logout', async () => {
  console.log('[Main] Logging out, closing user DB');
  await dbService.closeUserDb();
  return true;
});

// Get Data
ipcMain.handle('db:get', async (event, key) => {
  if (key === 'orbit_current_user') {
    return await dbService.getGlobal(key);
  }

  if (key === 'orbit_users') {
    // Per-user profile map (id -> User), stored in global KV
    return (await dbService.getGlobal(key)) || {};
  }

  // Per-user structured data
  if (key === 'orbit_settings') {
    return await dbService.getSettings();
  }
  if (key === 'orbit_contacts') {
    return await dbService.getContacts();
  }
  if (key === 'orbit_friend_requests') {
    return await dbService.getFriendRequests();
  }
    if (key === 'orbit_messages') {
      // Return all messages for compatibility (renderer will filter by conversationId)
      return await dbService.getAllMessages();
    }
    if (key === 'orbit_conversations') {
        // Reconstruct as array including lastMessage object, if resolvable
        const convos = await dbService.getConversations();
        const allMessages = await dbService.getAllMessages();
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
  const userVal = await dbService.getUser(key);
  if (userVal !== null && userVal !== undefined) return userVal;
  return dbService.getGlobal(key);
});

// Set Data
ipcMain.handle('db:set', async (event, { key, value }) => {
  if (key === 'orbit_current_user') {
    await dbService.setGlobal(key, value);
    return true;
  }
  if (key === 'orbit_users') {
    await dbService.setGlobal(key, value || {});
    return true;
  }
  if (key === 'orbit_settings') {
    await dbService.setSettingsKey('app', value);
    return true;
  }
  if (key === 'orbit_contacts') {
    await dbService.setContacts(value || []);
    return true;
  }
  if (key === 'orbit_friend_requests') {
    // storageService currently overwrites the whole table or operates per-row; we only handle full-table overwrite here
    // For simplicity, clear then upsert each entry one by one
    if (Array.isArray(value)) {
      for (const req of value) {
        await dbService.upsertFriendRequest(req);
      }
    }
    return true;
  }
    if (key === 'orbit_messages') {
      await dbService.replaceAllMessages(value || []);
      return true;
    }
    if (key === 'orbit_conversations') {
      await dbService.replaceAllConversations(value || []);
      return true;
    }

  const ok = await dbService.setUser(key, value);
  if (ok) return true;

  await dbService.setGlobal(key, value);
  return true;
});

// Clear Data
ipcMain.handle('db:clear', async () => {
  // 1. Find all images belonging to this user from messages in SQLite
  const allMessages = await dbService.getAllMessages();
  const imageFiles = Array.isArray(allMessages)
    ? allMessages
      .filter(m => m && m.type === 'IMAGE' && m.content && typeof m.content === 'string' && !m.content.startsWith('data:'))
      .map(m => m.content)
    : [];

  if (imageFiles.length > 0) {
    await fileService.deleteFiles(imageFiles);
  }

  // Also clear any remaining cached images to ensure full cleanup
  await fileService.clearImages();

  // 2. Clear only chat-related tables (messages & conversations)
  await dbService.clearUserChatsOnly?.();

  return true;
});

// Fine-grained DB operations for Electron renderer
ipcMain.handle('db:messages-by-conversation', async (event, conversationId) => {
  return await dbService.getMessagesByConversation(conversationId);
});

ipcMain.handle('db:message-upsert', async (event, message) => {
  await dbService.upsertMessage(message);
  return true;
});

ipcMain.handle('db:conversation-update-last', async (event, { conversationId, message, currentUserId }) => {
  const convos = await dbService.getConversations();
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

  await dbService.upsertConversation(convo);
  return true;
});

ipcMain.handle('db:conversation-create', async (event, { participantId, currentUserId }) => {
  const convos = await dbService.getConversations();
  const existing = convos.find(c => c.participantId === participantId);
  if (existing) return existing.id;

  const ids = [currentUserId, participantId].sort();
  const newId = `convo_${ids[0]}_${ids[1]}`;
  const now = Date.now();

  await dbService.upsertConversation({
    id: newId,
    participantId,
    unreadCount: 0,
    updatedAt: now,
    lastMessageId: null,
  });

  return newId;
});

ipcMain.handle('db:conversation-mark-read', async (event, conversationId) => {
  const convos = await dbService.getConversations();
  const existing = convos.find(c => c.id === conversationId);
  if (!existing) return true;
  existing.unreadCount = 0;
  await dbService.upsertConversation(existing);
  return true;
});

ipcMain.handle('db:convo-delete-by-participant', async (event, participantId) => {
  await dbService.deleteConversationByParticipant(participantId);
  return true;
});

// Friend requests fine-grained operations
ipcMain.handle('db:friend-request-upsert', async (event, request) => {
  await dbService.upsertFriendRequest(request);
  return true;
});

ipcMain.handle('db:friend-request-remove-by-userId', async (event, userId) => {
  await dbService.removeFriendRequestByUserId(userId);
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
