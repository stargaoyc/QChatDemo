
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const wss = new WebSocketServer({ port: PORT, host: HOST });

console.log(`Signaling Server started on ws://${HOST}:${PORT}`);

// Store clients: userId -> WebSocket
const clients = new Map();

// --- Offline message persistence ---
// Simple JSON file based store: { [userId]: Message[] }
const DATA_DIR = path.join(__dirname, 'data');
const OFFLINE_FILE = path.join(DATA_DIR, 'offlineMessages.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadOfflineStore() {
  try {
    if (!fs.existsSync(OFFLINE_FILE)) return {};
    const raw = fs.readFileSync(OFFLINE_FILE, 'utf-8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Failed to load offline store, starting empty.', e);
    return {};
  }
}

function saveOfflineStore(store) {
  try {
    fs.writeFileSync(OFFLINE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save offline store.', e);
  }
}

// In-memory cache, synced to disk on change
let offlineStore = loadOfflineStore();

function queueOfflineMessage(targetUserId, type, payload) {
  if (!targetUserId) return;
  if (!offlineStore[targetUserId]) {
    offlineStore[targetUserId] = [];
  }
  offlineStore[targetUserId].push({ type, payload, queuedAt: Date.now() });
  saveOfflineStore(offlineStore);
}

function deliverQueuedMessages(userId, ws) {
  const messages = offlineStore[userId];
  if (!messages || !messages.length) return;

  console.log(`Delivering ${messages.length} queued messages to ${userId}`);
  for (const msg of messages) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }));
    }
  }

  // Clear after successful attempt
  delete offlineStore[userId];
  saveOfflineStore(offlineStore);
}

wss.on('connection', (ws) => {
  let currentUserId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // Handle Heartbeat
      if (message.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
      }

      // Handle Authentication / Registration
      if (message.type === 'AUTH') {
        currentUserId = message.userId;

        // Check if user is already connected
        if (clients.has(currentUserId)) {
          console.log(`User ${currentUserId} already connected. Kicking old session.`);
          const oldWs = clients.get(currentUserId);
          if (oldWs.readyState === 1) { // OPEN
            oldWs.send(JSON.stringify({ 
              type: 'FORCE_LOGOUT', 
              reason: 'Account logged in from another location' 
            }));
            oldWs.close();
          }
        }

        clients.set(currentUserId, ws);
        console.log(`User connected: ${currentUserId}`);
        
        // Send list of currently online users to the new user
        const onlineUsers = Array.from(clients.keys()).filter(id => id !== currentUserId);
        ws.send(JSON.stringify({
            type: 'ONLINE_USERS_LIST',
            userIds: onlineUsers
        }));

        // Deliver any queued offline messages for this user
        deliverQueuedMessages(currentUserId, ws);

        // Broadcast presence
        broadcastStatus(currentUserId, 'online');
        return;
      }

      // Handle P2P/Relay Message (Chat & Friend Signals)
      const RELAY_TYPES = ['CHAT', 'FRIEND_REQUEST', 'FRIEND_ACCEPT', 'FRIEND_REMOVE', 'MESSAGE_DELIVERED'];
      if (RELAY_TYPES.includes(message.type)) {
        const { targetUserId, payload } = message;
        const targetWs = clients.get(targetUserId);
        
        if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
          targetWs.send(JSON.stringify({
            type: message.type,
            payload: payload
          }));
          console.log(`Relayed ${message.type} from ${currentUserId} to ${targetUserId}`);
        } else {
          // Persist offline messages so they survive server restarts
          console.log(`User ${targetUserId} is offline or not found. Queuing offline ${message.type}.`);
          // Only queue actual chat payloads and delivery receipts; friend signals usually can be ignored/offline as needed
          if (message.type === 'CHAT' || message.type === 'FRIEND_REQUEST' || message.type === 'FRIEND_ACCEPT') {
            queueOfflineMessage(targetUserId, message.type, payload);
          }
        }
      }

    } catch (e) {
      console.error('Failed to parse message', e);
    }
  });

  ws.on('close', () => {
    if (currentUserId && clients.get(currentUserId) === ws) {
      clients.delete(currentUserId);
      console.log(`User disconnected: ${currentUserId}`);
      broadcastStatus(currentUserId, 'offline');
    }
  });
});

function broadcastStatus(userId, status) {
  const statusMsg = JSON.stringify({
    type: 'STATUS_UPDATE',
    userId,
    status
  });
  
  for (const client of clients.values()) {
    if (client.readyState === 1) {
      client.send(statusMsg);
    }
  }
}
