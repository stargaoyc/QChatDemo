import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";

// Mock fs
vi.mock("fs", () => {
  return {
    default: {
      existsSync: vi.fn(() => false), // Start with no files
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => "{}"),
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
  };
});

describe("WebSocket Server", () => {
  let wss;
  let client1;
  let client2;
  let startServer;
  const PORT = 8082; // Use a different port
  const HOST = "localhost";
  const WS_URL = `ws://${HOST}:${PORT}`;
  const TEST_USER_1 = `test_user_${Date.now()}_1`;
  const TEST_USER_2 = `test_user_${Date.now()}_2`;

  beforeAll(async () => {
    vi.resetModules(); // Ensure we get a fresh module
    const module = await import("../../server/index.js");
    startServer = module.startServer;
    wss = startServer(PORT, HOST);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(() => {
    if (wss) wss.close();
  });

  it("should allow a client to connect", async () => {
    client1 = new WebSocket(WS_URL);
    await new Promise((resolve) => client1.on("open", resolve));
    expect(client1.readyState).toBe(WebSocket.OPEN);
  });

  it("should respond to PING with PONG", async () => {
    const promise = new Promise((resolve) => {
      client1.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "PONG") resolve(true);
      });
    });
    client1.send(JSON.stringify({ type: "PING" }));
    await expect(promise).resolves.toBe(true);
  });

  it("should allow user registration", async () => {
    const promise = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "REGISTER_RESULT") {
          client1.off("message", handler);
          resolve(msg);
        }
      };
      client1.on("message", handler);
    });
    // Use unique user ID to be safe
    client1.send(
      JSON.stringify({ type: "REGISTER", userId: TEST_USER_1, password: "password123" }),
    );
    const result: any = await promise;
    if (!result.success) console.log("Registration failed:", result);
    expect(result.success).toBe(true);
  });

  it("should allow user authentication", async () => {
    const promise = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "AUTH_RESULT") {
          client1.off("message", handler);
          resolve(msg);
        }
      };
      client1.on("message", handler);
    });
    client1.send(
      JSON.stringify({
        type: "AUTH",
        userId: TEST_USER_1,
        password: "password123",
        publicKey: "key1",
      }),
    );
    const result: any = await promise;
    expect(result.success).toBe(true);
  });

  it("should relay messages between users", async () => {
    // Connect second client
    client2 = new WebSocket(WS_URL);
    await new Promise((resolve) => client2.on("open", resolve));

    // Register and Auth client 2
    await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "REGISTER_RESULT") {
          client2.off("message", handler);
          resolve(msg);
        }
      };
      client2.on("message", handler);
      client2.send(
        JSON.stringify({ type: "REGISTER", userId: TEST_USER_2, password: "password123" }),
      );
    });

    await new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "AUTH_RESULT") {
          client2.off("message", handler);
          resolve(msg);
        }
      };
      client2.on("message", handler);
      client2.send(
        JSON.stringify({
          type: "AUTH",
          userId: TEST_USER_2,
          password: "password123",
          publicKey: "key2",
        }),
      );
    });

    // Setup listener on client 2 for chat message
    const chatPromise = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "CHAT") {
          client2.off("message", handler);
          resolve(msg);
        }
      };
      client2.on("message", handler);
    });

    // Client 1 sends message to Client 2
    client1.send(
      JSON.stringify({
        type: "CHAT",
        targetUserId: TEST_USER_2,
        payload: { content: "Hello User 2" },
      }),
    );

    const receivedMsg: any = await chatPromise;
    expect(receivedMsg.payload.content).toBe("Hello User 2");

    client2.close();
  });

  afterAll(() => {
    if (client1) client1.close();
    if (client2) client2.close();
  });
});
