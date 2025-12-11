const WebSocket = require("ws");

// Configuration
const SERVER_URL = "ws://localhost:8080";
const USER_A = { userId: "demo_alice", password: "password123", username: "Alice" };
const USER_B = { userId: "demo_bob", password: "password123", username: "Bob" };

function createClient(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let authenticated = false;

    ws.on("open", () => {
      console.log(`[${user.username}] Connected to ${SERVER_URL}`);
      // 1. Try Register
      ws.send(JSON.stringify({ type: "REGISTER", userId: user.userId, password: user.password }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data);
      console.log(`[${user.username}] Received: ${msg.type}`);

      if (msg.type === "REGISTER_RESULT") {
        if (msg.success || msg.reason === "USER_EXISTS") {
          console.log(`[${user.username}] Registered/Exists. Logging in...`);
          // 2. Login
          ws.send(
            JSON.stringify({
              type: "AUTH",
              userId: user.userId,
              password: user.password,
              username: user.username,
            }),
          );
        } else {
          console.error(`[${user.username}] Registration failed: ${msg.reason}`);
          reject(msg.reason);
        }
      } else if (msg.type === "AUTH_RESULT") {
        if (msg.success) {
          console.log(`[${user.username}] Authenticated!`);
          authenticated = true;
          resolve(ws);
        } else {
          console.error(`[${user.username}] Auth failed: ${msg.reason}`);
          reject(msg.reason);
        }
      } else if (msg.type === "CHAT") {
        console.log(
          `[${user.username}] Incoming Message from ${msg.payload.senderId}: "${msg.payload.content}"`,
        );
        // Auto-reply if it's Bob
        if (user.userId === USER_B.userId) {
          console.log(`[${user.username}] Sending delivery receipt...`);
          ws.send(
            JSON.stringify({
              type: "MESSAGE_DELIVERED",
              targetUserId: msg.payload.senderId,
              payload: { messageId: msg.payload.id },
            }),
          );
        }
      } else if (msg.type === "MESSAGE_DELIVERED") {
        console.log(`[${user.username}] Message ${msg.payload.messageId} was delivered!`);
      }
    });

    ws.on("error", (err) => {
      console.error(`[${user.username}] Error:`, err.message);
      reject(err);
    });
  });
}

async function runDemo() {
  console.log("Starting Demo Scenario...");
  console.log("Ensure the server is running (npm run server) before running this script.\n");

  try {
    // 1. Connect Bob first so he is online to receive
    const wsBob = await createClient(USER_B);

    // 2. Connect Alice
    const wsAlice = await createClient(USER_A);

    // 3. Alice sends message to Bob
    console.log("\n--- Interaction Start ---");
    const msgId = "msg_" + Date.now();
    const chatMsg = {
      type: "CHAT",
      targetUserId: USER_B.userId,
      payload: {
        id: msgId,
        conversationId: "convo_demo",
        senderId: USER_A.userId,
        type: "TEXT",
        content: "Hello Bob, this is a demo message!",
        timestamp: Date.now(),
      },
    };

    console.log(`[Alice] Sending: "${chatMsg.payload.content}"`);
    wsAlice.send(JSON.stringify(chatMsg));

    // Keep alive for a few seconds to receive replies
    await new Promise((r) => setTimeout(r, 3000));

    console.log("\n--- Interaction End ---");
    wsAlice.close();
    wsBob.close();
    console.log("Demo finished successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Demo failed:", err);
    process.exit(1);
  }
}

runDemo();
