const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Store clients: userId -> { ws, username? }
const clients = new Map();

// --- Offline message persistence ---
const DATA_DIR = path.join(__dirname, "data");
const OFFLINE_FILE = path.join(DATA_DIR, "offlineMessages.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadOfflineStore() {
  try {
    if (!fs.existsSync(OFFLINE_FILE)) return {};
    const raw = fs.readFileSync(OFFLINE_FILE, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load offline store, starting empty.", e);
    return {};
  }
}

function saveOfflineStore(store) {
  try {
    fs.writeFileSync(OFFLINE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save offline store.", e);
  }
}

function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return {};
    const raw = fs.readFileSync(ACCOUNTS_FILE, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load accounts store, starting empty.", e);
    return {};
  }
}

function saveAccounts(store) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save accounts store.", e);
  }
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// In-memory cache, synced to disk on change
let offlineStore = loadOfflineStore();
let accountsStore = loadAccounts();

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

function broadcastStatus(userId, status, publicKey) {
  const statusMsg = JSON.stringify({
    type: "STATUS_UPDATE",
    userId,
    status,
    publicKey,
  });

  for (const [clientId, { ws }] of clients.entries()) {
    // Skip sending to the user themselves
    if (clientId === userId) continue;
    if (ws.readyState === 1) {
      ws.send(statusMsg);
    }
  }
}

function startServer(port, host) {
  const wss = new WebSocketServer({ port, host });
  console.log(`Signaling Server started on ws://${host}:${port}`);

  wss.on("connection", (ws, req) => {
    let currentUserId = null;
    let authenticated = false;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);

        // Handle Heartbeat
        if (message.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG" }));
          return;
        }

        // Handle Authentication / Registration
        if (message.type === "REGISTER") {
          const { userId, password } = message;
          if (!userId || !password) {
            ws.send(
              JSON.stringify({ type: "REGISTER_RESULT", success: false, reason: "INVALID_INPUT" }),
            );
            return;
          }

          if (accountsStore[userId]) {
            ws.send(
              JSON.stringify({ type: "REGISTER_RESULT", success: false, reason: "USER_EXISTS" }),
            );
            return;
          }

          accountsStore[userId] = { passwordHash: hashPassword(password) };
          saveAccounts(accountsStore);
          console.log(`Registered new user: ${userId}`);
          ws.send(JSON.stringify({ type: "REGISTER_RESULT", success: true }));
          return;
        }

        if (message.type === "AUTH") {
          currentUserId = message.userId;
          const password = message.password;
          const publicKey = message.publicKey;

          if (!currentUserId || !password) {
            ws.send(
              JSON.stringify({ type: "AUTH_RESULT", success: false, reason: "INVALID_INPUT" }),
            );
            return;
          }

          const account = accountsStore[currentUserId];
          if (!account) {
            ws.send(
              JSON.stringify({ type: "AUTH_RESULT", success: false, reason: "NOT_REGISTERED" }),
            );
            return;
          }

          const isPasswordOk = account.passwordHash === hashPassword(password);
          if (!isPasswordOk) {
            ws.send(
              JSON.stringify({ type: "AUTH_RESULT", success: false, reason: "BAD_PASSWORD" }),
            );
            return;
          }

          // Check if user is already connected
          if (clients.has(currentUserId)) {
            console.log(`User ${currentUserId} already connected. Kicking old session.`);
            const oldWs = clients.get(currentUserId).ws;
            if (oldWs.readyState === 1) {
              // OPEN
              oldWs.send(
                JSON.stringify({
                  type: "FORCE_LOGOUT",
                  reason: "Account logged in from another location",
                }),
              );
              oldWs.close();
            }
          }

          // Store connection with optional username and publicKey
          clients.set(currentUserId, { ws, username: message.username, publicKey });
          authenticated = true;
          console.log(`User connected: ${currentUserId} (username: ${message.username || "N/A"})`);

          // Send list of currently online users to the new user
          const onlineUsers = Array.from(clients.keys()).filter((id) => id !== currentUserId);
          try {
            ws.send(
              JSON.stringify({
                type: "ONLINE_USERS_LIST",
                userIds: onlineUsers,
              }),
            );
          } catch (e) {
            console.error(`Failed sending ONLINE_USERS_LIST to ${currentUserId}`, e);
          }

          // Send keys of online users
          const userKeys = {};
          for (const [id, client] of clients.entries()) {
            if (id !== currentUserId && client.publicKey) {
              userKeys[id] = client.publicKey;
            }
          }
          try {
            ws.send(
              JSON.stringify({
                type: "USER_KEYS_LIST",
                keys: userKeys,
              }),
            );
          } catch (e) {
            console.error(`Failed sending USER_KEYS_LIST to ${currentUserId}`, e);
          }

          // Deliver any queued offline messages for this user
          deliverQueuedMessages(currentUserId, ws);

          // Broadcast presence
          broadcastStatus(currentUserId, "online", publicKey);

          // Notify client auth success
          try {
            ws.send(JSON.stringify({ type: "AUTH_RESULT", success: true }));
            console.log(`Auth success and ACK sent for ${currentUserId}`);
          } catch (e) {
            console.error(`Failed sending AUTH_RESULT to ${currentUserId}`, e);
          }
          return;
        }

        // Handle P2P/Relay Message (Chat & Friend Signals)
        const RELAY_TYPES = [
          "CHAT",
          "FRIEND_REQUEST",
          "FRIEND_ACCEPT",
          "FRIEND_REMOVE",
          "MESSAGE_DELIVERED",
        ];
        if (RELAY_TYPES.includes(message.type)) {
          if (!authenticated) return; // Ignore relay attempts before auth
          const { targetUserId, payload } = message;
          const target = clients.get(targetUserId);
          const targetWs = target && target.ws;

          if (targetWs && targetWs.readyState === 1) {
            // 1 = OPEN
            targetWs.send(
              JSON.stringify({
                type: message.type,
                payload: payload,
              }),
            );
            console.log(`Relayed ${message.type} from ${currentUserId} to ${targetUserId}`);
          } else {
            // Persist offline messages so they survive server restarts
            console.log(
              `User ${targetUserId} is offline or not found. Queuing offline ${message.type}.`,
            );
            // Only queue actual chat payloads and delivery receipts; friend signals usually can be ignored/offline as needed
            if (
              message.type === "CHAT" ||
              message.type === "FRIEND_REQUEST" ||
              message.type === "FRIEND_ACCEPT"
            ) {
              queueOfflineMessage(targetUserId, message.type, payload);
            }
          }
          return;
        }

        // Handle user profile updates (e.g., nickname)
        if (message.type === "USER_UPDATE") {
          if (!authenticated) return;
          const userId = message.from;
          const { username } = message.payload || {};
          if (!userId || !username) return;

          const clientInfo = clients.get(userId);
          if (!clientInfo) return;

          // Update server-side cached username
          clientInfo.username = username;
          clients.set(userId, clientInfo);

          const broadcastMsg = JSON.stringify({
            type: "USER_UPDATE_BROADCAST",
            from: userId,
            payload: { username },
          });

          // For now, broadcast to all connected clients
          for (const { ws: clientWs } of clients.values()) {
            if (clientWs && clientWs.readyState === 1) {
              clientWs.send(broadcastMsg);
            }
          }
          return;
        }

        if (message.type === "CHANGE_PASSWORD") {
          if (!authenticated) return;
          const { newPassword } = message;
          if (!newPassword || typeof newPassword !== "string" || !newPassword.trim()) {
            ws.send(
              JSON.stringify({
                type: "CHANGE_PASSWORD_RESULT",
                success: false,
                reason: "INVALID_INPUT",
              }),
            );
            return;
          }
          accountsStore[currentUserId] = { passwordHash: hashPassword(newPassword) };
          saveAccounts(accountsStore);
          ws.send(JSON.stringify({ type: "CHANGE_PASSWORD_RESULT", success: true }));
          return;
        }
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    });

    ws.on("close", (code, reasonBuffer) => {
      const reason = reasonBuffer?.toString() || "";
      const ip = req.socket?.remoteAddress || "unknown";
      if (currentUserId) {
        const clientInfo = clients.get(currentUserId);
        if (clientInfo && clientInfo.ws === ws) {
          clients.delete(currentUserId);
          console.log(
            `User disconnected: ${currentUserId} code=${code} reason=${reason} ip=${ip} authenticated=${authenticated}`,
          );
          broadcastStatus(currentUserId, "offline");
        } else {
          console.log(
            `Close for ${currentUserId} but socket mismatch; code=${code} reason=${reason} ip=${ip}`,
          );
        }
      } else {
        console.log(`Unauthed socket closed code=${code} reason=${reason} ip=${ip}`);
      }
    });

    ws.on("error", (err) => {
      const ip = req.socket?.remoteAddress || "unknown";
      console.error(`Socket error ip=${ip} user=${currentUserId || "unknown"}`, err);
    });
  });

  return wss;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 8080;
  const HOST = process.env.HOST || "0.0.0.0";
  startServer(PORT, HOST);
}

module.exports = { startServer };
