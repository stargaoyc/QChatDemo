// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { socketService } from "../../services/socketService";

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState: number;
  onopen: () => void = () => {};
  onmessage: (event: any) => void = () => {};
  onclose: () => void = () => {};
  onerror: (err: any) => void = () => {};

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(_data: string) {}
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
    const user = { id: "u1", username: "test", avatar: "", status: "online" as const };
    socketService.configureServer("localhost", 8080);

    await socketService.connect(user, "password");

    expect(socketService.getState()).toBe("CONNECTING");

    // Fast-forward time for the mock websocket to open
    await vi.advanceTimersByTimeAsync(50);

    expect(socketService.getState()).toBe("CONNECTED");
  });

  it("should send AUTH message upon connection", async () => {
    const user = { id: "u1", username: "test", avatar: "", status: "online" as const };
    const sendSpy = vi.spyOn(MockWebSocket.prototype, "send");

    await socketService.connect(user, "secret");
    await vi.advanceTimersByTimeAsync(50);

    expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('"type":"AUTH"'));
    expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('"userId":"u1"'));
  });
});
