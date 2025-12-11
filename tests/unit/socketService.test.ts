// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SocketService } from "../../services/socketService"; // Note: You might need to export the class or use the instance
// Assuming socketService exports the instance by default, but for testing we might want to access the class or reset the instance.
// Since the file exports `export const socketService = new SocketService();`, we can test that instance but state might persist.
// Ideally, we would export the class too. Let's assume we can modify the file to export the class or just test the singleton carefully.

// To make it testable without changing source code too much, we will rely on the singleton but reset it if possible.
// However, `socketService.ts` does not export the class `SocketService` directly in the previous `read_file` output.
// It has `class SocketService { ... }` and `export const socketService = new SocketService();`.
// I will try to import the singleton.

import { socketService } from "../../services/socketService";

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState: number;
  onopen: () => void = () => {};
  onmessage: (event: any) => void = () => {};
  onclose: () => void = () => {};
  onerror: (err: any) => void = () => {};

  send(data: string) {}
  close() {}

  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen();
    }, 10);
  }
}

global.WebSocket = MockWebSocket as any;

describe("SocketService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset socketService state if possible, or just disconnect
    socketService.disconnect();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize in DISCONNECTED state", () => {
    expect(socketService.getState()).toBe("DISCONNECTED");
  });

  it("should attempt to connect when connect() is called", async () => {
    const user = { id: "u1", username: "test", avatar: "" };
    socketService.configureServer("localhost", 8080);

    await socketService.connect(user, "password");

    expect(socketService.getState()).toBe("CONNECTING");

    // Fast-forward time for the mock websocket to open
    await vi.advanceTimersByTimeAsync(50);

    expect(socketService.getState()).toBe("CONNECTED");
  });

  it("should send AUTH message upon connection", async () => {
    const user = { id: "u1", username: "test", avatar: "" };
    const sendSpy = vi.spyOn(MockWebSocket.prototype, "send");

    await socketService.connect(user, "secret");
    await vi.advanceTimersByTimeAsync(50);

    expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('"type":"AUTH"'));
    expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('"userId":"u1"'));
  });
});
