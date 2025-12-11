import { Message, User } from "../types";
import { logger } from "./logger";
import { SOCKET_HEARTBEAT_INTERVAL } from "../constants";
import { cryptoService } from "./cryptoService";

type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING";

type MessageHandler = (message: Message) => void;
type ConnectionHandler = (state: ConnectionState) => void;
type FriendSignalHandler = (payload: any) => void;
type StatusUpdateHandler = (userId: string, status: string) => void;
type ForceLogoutHandler = () => void;
type OnlineUsersListHandler = (userIds: string[]) => void;
type DeliveryReceiptHandler = (messageId: string) => void;
type UserUpdateHandler = (data: { userId: string; username: string }) => void;
type AuthResultHandler = (result: { success: boolean; reason?: string }) => void;
type ChangePasswordHandler = (result: { success: boolean; reason?: string }) => void;

class SocketService {
  private state: ConnectionState = "DISCONNECTED";
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();

  private friendRequestHandlers: Set<FriendSignalHandler> = new Set();
  private friendAcceptHandlers: Set<FriendSignalHandler> = new Set();
  private friendRemoveHandlers: Set<FriendSignalHandler> = new Set();
  private statusUpdateHandlers: Set<StatusUpdateHandler> = new Set();
  private forceLogoutHandlers: Set<ForceLogoutHandler> = new Set();
  private onlineUsersListHandlers: Set<OnlineUsersListHandler> = new Set();
  private deliveryReceiptHandlers: Set<DeliveryReceiptHandler> = new Set();
  private userUpdateHandlers: Set<UserUpdateHandler> = new Set();
  private authResultHandlers: Set<AuthResultHandler> = new Set();
  private changePasswordHandlers: Set<ChangePasswordHandler> = new Set();

  // Cache for online users to handle race conditions
  private cachedOnlineUsers: Set<string> = new Set();

  private heartbeatTimer: any = null;
  private socket: WebSocket | null = null;

  // Connection Logic
  private endpointList: string[] = [];
  private currentEndpointIndex: number = 0;
  private connectionTimeoutId: any = null;
  private wsUrl: string = ""; // Current URL for reference
  private endpointAttempts: number = 0;
  private readonly MAX_ATTEMPTS_PER_ENDPOINT: number = 2;
  private readonly CONNECTION_TIMEOUT_MS: number = 8000; // increased from 3000

  private currentUser: User | null = null;
  private currentPassword: string | null = null;
  // Cache messages received before any UI handler is attached
  private earlyMessages: Message[] = [];
  private changePasswordPending: Array<(res: { success: boolean; reason?: string }) => void> = [];

  getState(): ConnectionState {
    return this.state;
  }

  isMockMode(): boolean {
    return false;
  }

  // Configure endpoints based on user input
  configureServer(host?: string, port?: string | number) {
    this.endpointList = [];
    // Regex for IPv4 or Domain Name (including localhost)
    const hostRegex =
      /^((25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3})$|^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$|^localhost$/;

    const rawHost = host ? host.trim() : "";
    let finalHost = rawHost;
    let finalPort = port && String(port).trim() ? port : null;

    // Support 'IP:port' or 'Domain:port' in host field
    if (rawHost && rawHost.includes(":") && !finalPort) {
      const parts = rawHost.split(":");
      if (parts.length === 2) {
        finalHost = parts[0];
        finalPort = parts[1];
      }
    }

    if (finalHost && hostRegex.test(finalHost)) {
      // User specified valid Host
      const p = finalPort && String(finalPort).trim() ? finalPort : 8080;
      this.endpointList.push(`ws://${finalHost}:${p}`);
    } else {
      // Empty or invalid -> Fallback Chain
      // 1. Localhost
      this.endpointList.push("ws://localhost:8080");
      // 2. Hardcoded Fallback
      // this.endpointList.push("ws://111.170.33.13:48080");
    }

    logger.info("Network", `Configured endpoints: ${JSON.stringify(this.endpointList)}`);
  }

  async connect(user: User, password?: string) {
    if (this.state === "CONNECTED") return;
    if (this.state === "CONNECTING") {
      logger.info("Network", "Already connecting — ignoring duplicate connect request.");
      return;
    }
    this.currentUser = user;
    this.currentPassword = password || null;

    await cryptoService.init(user.id);

    this.currentEndpointIndex = 0;

    // If no endpoints configured (shouldn't happen if configureServer called, but safety check)
    if (this.endpointList.length === 0) {
      this.configureServer(); // Load defaults
    }

    this.tryNextEndpoint();
  }

  private async tryNextEndpoint() {
    if (this.currentEndpointIndex >= this.endpointList.length) {
      logger.error("Network", "All connection endpoints failed.");
      this.updateState("DISCONNECTED");
      return;
    }

    let url = this.endpointList[this.currentEndpointIndex];
    this.updateState("CONNECTING");
    logger.info(
      "Network",
      `Connecting to ${url} (${this.currentEndpointIndex + 1}/${this.endpointList.length})...`,
    );

    // Check if URL contains a domain that needs resolution
    // Format: ws://host:port
    // Removed manual DNS resolution to rely on native WebSocket resolution and improve performance.
    /*
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const port = urlObj.port;

      // If hostname is not an IP address (and not localhost, though localhost is fine to resolve too, but usually handled by OS)
      // Simple check: if it contains letters and is not localhost
      const isIp = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);

      if (!isIp && hostname !== "localhost") {
        logger.info("Network", `Resolving domain ${hostname}...`);
        // Call Main Process to resolve DNS
        const resolvedIp = await (window as any).electronAPI.invoke("net:resolve-dns", hostname);

        if (resolvedIp) {
          logger.info("Network", `Resolved ${hostname} -> ${resolvedIp}`);
          // Reconstruct URL with IP
          url = `ws://${resolvedIp}:${port}`;
        } else {
          logger.warn("Network", `Failed to resolve domain ${hostname}, trying original URL.`);
        }
      }
    } catch (e) {
      logger.warn("Network", `Error parsing/resolving URL ${url}:`, e);
    }
    */

    this.wsUrl = url;
    this.connectSocket(url);
  }

  private connectSocket(url: string) {
    // Clean up previous socket/timer
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
    }

    try {
      this.socket = new WebSocket(url);

      // Timeout for this specific connection attempt
      this.connectionTimeoutId = setTimeout(() => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          logger.warn("Network", `Connection to ${url} timed out.`);
          // Closing the socket will trigger onclose, which handles the next step
          this.socket?.close();
        }
      }, this.CONNECTION_TIMEOUT_MS);

      this.socket.onopen = () => {
        clearTimeout(this.connectionTimeoutId);
        logger.info(
          "Network",
          `WebSocket Connected to ${url} (socket.readyState=${this.socket?.readyState})`,
        );
        this.updateState("CONNECTED");
        // reset attempts on successful connection
        this.endpointAttempts = 0;
        this.startHeartbeat();

        // Authenticate (log that we're sending AUTH but do not print password)
        if (this.currentUser) {
          logger.info(
            "Network",
            `Sending AUTH for ${this.currentUser.id} (username=${this.currentUser.username})`,
          );
          try {
            this.socket?.send(
              JSON.stringify({
                type: "AUTH",
                userId: this.currentUser.id,
                username: this.currentUser.username,
                password: this.currentPassword || "",
                publicKey: cryptoService.getPublicKey(),
              }),
            );
          } catch (e) {
            logger.error("Network", "Failed to send AUTH", e);
          }
        }
      };

      this.socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "PONG") return;

          if (data.type === "FORCE_LOGOUT") {
            logger.warn("Network", "Received FORCE_LOGOUT");
            this.disconnect();
            this.forceLogoutHandlers.forEach((h) => h());
            return;
          }

          if (data.type === "AUTH_RESULT") {
            logger.info(
              "Network",
              `Received AUTH_RESULT: success=${data.success} reason=${data.reason || "none"}`,
            );
            if (!data.success) {
              this.notifyAuthResult({ success: false, reason: data.reason });
              this.disconnect();
              return;
            }
            this.notifyAuthResult({ success: true });
            return;
          }

          if (data.type === "CHANGE_PASSWORD_RESULT") {
            this.notifyChangePassword(data);
            return;
          }

          if (data.type === "USER_KEYS_LIST") {
            const keys = data.keys;
            for (const [uid, key] of Object.entries(keys)) {
              await cryptoService.computeSharedSecret(uid, key as string);
            }
            return;
          }

          if (data.type === "CHAT") {
            try {
              const decrypted = await cryptoService.decrypt(
                data.payload.content,
                data.payload.senderId,
              );
              data.payload.content = decrypted;
            } catch (e) {
              logger.error("Crypto", "Decryption failed", e);
            }
            this.notifyMessage(data.payload as Message);
          }
          if (data.type === "FRIEND_REQUEST") {
            this.friendRequestHandlers.forEach((h) => h(data.payload));
          }
          if (data.type === "FRIEND_ACCEPT") {
            this.friendAcceptHandlers.forEach((h) => h(data.payload));
          }
          if (data.type === "FRIEND_REMOVE") {
            this.friendRemoveHandlers.forEach((h) => h(data.payload));
          }
          if (data.type === "STATUS_UPDATE") {
            if (data.publicKey) {
              await cryptoService.computeSharedSecret(data.userId, data.publicKey);
            }
            if (data.status === "online") {
              this.cachedOnlineUsers.add(data.userId);
            } else {
              this.cachedOnlineUsers.delete(data.userId);
            }
            this.statusUpdateHandlers.forEach((h) => h(data.userId, data.status));
          }
          if (data.type === "ONLINE_USERS_LIST") {
            this.cachedOnlineUsers = new Set(data.userIds);
            this.onlineUsersListHandlers.forEach((h) => h(data.userIds));
          }
          if (data.type === "MESSAGE_DELIVERED") {
            this.deliveryReceiptHandlers.forEach((h) => h(data.payload.messageId));
          }
          if (data.type === "USER_UPDATE_BROADCAST") {
            const { from, payload } = data;
            if (from && payload && payload.username) {
              this.userUpdateHandlers.forEach((h) =>
                h({ userId: from, username: payload.username }),
              );
            }
          }
        } catch (err) {
          logger.error("Network", "Failed to parse message", err);
        }
      };

      this.socket.onclose = (ev) => {
        clearTimeout(this.connectionTimeoutId);
        this.stopHeartbeat();

        const code = ev && (ev as any).code ? (ev as any).code : "unknown";
        const reason = ev && (ev as any).reason ? (ev as any).reason : "";
        const readyState = this.socket?.readyState;
        const fromState = this.state;

        if (fromState === "CONNECTED") {
          // Was connected, now disconnected unexpectedly
          this.updateState("DISCONNECTED");
          logger.warn(
            "Network",
            `Socket closed unexpectedly. url=${url} code=${code} reason=${reason} readyState=${readyState}`,
          );
        } else {
          // Was connecting, failed. Try next endpoint.
          logger.warn(
            "Network",
            `Failed to connect to ${url}. code=${code} reason=${reason} readyState=${readyState}`,
          );
          // Retry same endpoint a few times before moving to next
          if (this.endpointAttempts < this.MAX_ATTEMPTS_PER_ENDPOINT) {
            this.endpointAttempts++;
            logger.info(
              "Network",
              `Retrying ${url} (attempt ${this.endpointAttempts}/${this.MAX_ATTEMPTS_PER_ENDPOINT}) after delay.`,
            );
            // Indicate to UI we're retrying the same endpoint
            this.updateState("RECONNECTING");
            setTimeout(() => this.connectSocket(url), 1000);
          } else {
            this.endpointAttempts = 0;
            this.currentEndpointIndex++;
            this.tryNextEndpoint();
          }
        }
      };

      this.socket.onerror = (err) => {
        // Error usually precedes close. We let onclose handle the logic but log event details too.
        try {
          logger.error("Network", `Socket error with ${url}`, err);
        } catch (e) {
          logger.error("Network", `Socket error with ${url} (failed to log event)`);
        }
      };
    } catch (e) {
      logger.error("Network", "Connection failed immediately", e);
      this.currentEndpointIndex++;
      this.tryNextEndpoint();
    }
  }

  disconnect() {
    // Log stack trace to find out who called disconnect
    logger.warn("Network", "disconnect() called", new Error().stack);

    this.stopHeartbeat();
    if (this.connectionTimeoutId) clearTimeout(this.connectionTimeoutId);
    if (this.socket) {
      // Prevent onclose from triggering next endpoint if we manually disconnect
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.updateState("DISCONNECTED");
    this.currentUser = null;
    this.cachedOnlineUsers.clear();
  }

  async register(userId: string, password: string): Promise<{ success: boolean; reason?: string }> {
    if (!userId || !password) {
      return { success: false, reason: "INVALID_INPUT" };
    }

    if (this.endpointList.length === 0) {
      this.configureServer();
    }

    const tryEndpoint = (index: number): Promise<{ success: boolean; reason?: string }> => {
      if (index >= this.endpointList.length) {
        return Promise.resolve({ success: false, reason: "CONNECTION_FAILED" });
      }

      return new Promise((resolve) => {
        const url = this.endpointList[index];
        let settled = false;
        const ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          ws.close();
          resolve(tryEndpoint(index + 1));
        }, 4000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "REGISTER", userId, password }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "REGISTER_RESULT") {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              resolve({ success: !!data.success, reason: data.reason });
            }
          } catch (_e) {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(tryEndpoint(index + 1));
        };

        ws.onclose = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(tryEndpoint(index + 1));
        };
      });
    };

    return tryEndpoint(0);
  }

  async sendMessage(message: Message, recipientId: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      let contentToSend = message.content;
      try {
        contentToSend = await cryptoService.encrypt(message.content, recipientId);
      } catch (e) {
        logger.warn(
          "Crypto",
          `Encryption failed for ${recipientId}, sending plain text fallback.`,
          e,
        );
      }

      const payload = { ...message, content: contentToSend };

      this.socket.send(
        JSON.stringify({
          type: "CHAT",
          targetUserId: recipientId,
          payload: payload,
        }),
      );
    } else {
      logger.error("Network", "Cannot send message: Socket not open");
      throw new Error("Network disconnected");
    }
  }

  async sendDeliveryReceipt(messageId: string, recipientId: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "MESSAGE_DELIVERED",
          targetUserId: recipientId,
          payload: { messageId },
        }),
      );
    }
  }

  // --- Friend Signal Methods ---

  async sendFriendRequest(targetUserId: string, currentUser: User) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "FRIEND_REQUEST",
          targetUserId: targetUserId,
          payload: { fromUser: currentUser, timestamp: Date.now() },
        }),
      );
    } else {
      throw new Error("Network disconnected");
    }
  }

  async acceptFriendRequest(targetUserId: string, currentUser: User) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "FRIEND_ACCEPT",
          targetUserId: targetUserId,
          payload: { user: currentUser },
        }),
      );
    }
  }

  async removeFriend(targetUserId: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "FRIEND_REMOVE",
          targetUserId: targetUserId,
          payload: { userId: this.currentUser?.id },
        }),
      );
    }
  }

  async changePassword(newPassword: string): Promise<{ success: boolean; reason?: string }> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return { success: false, reason: "DISCONNECTED" };
    }
    return new Promise((resolve) => {
      this.changePasswordPending.push(resolve);
      this.socket?.send(JSON.stringify({ type: "CHANGE_PASSWORD", newPassword }));
      setTimeout(() => {
        // timeout safeguard
        const idx = this.changePasswordPending.indexOf(resolve);
        if (idx >= 0) {
          this.changePasswordPending.splice(idx, 1);
          resolve({ success: false, reason: "TIMEOUT" });
        }
      }, 5000);
    });
  }

  // --- User Profile Methods ---

  async sendUserUpdate(user: User) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: "USER_UPDATE",
          from: user.id,
          payload: { username: user.username },
        }),
      );
    }
  }

  // --- Listeners ---

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    // Immediately replay any messages that arrived before handler registration
    if (this.earlyMessages.length > 0) {
      this.earlyMessages.forEach((m) => handler(m));
      // Clear buffer after first replay to avoid duplicates on subsequent subscriptions
      this.earlyMessages = [];
    }
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler) {
    this.connectionHandlers.add(handler);
    handler(this.state);
    return () => this.connectionHandlers.delete(handler);
  }

  onFriendRequest(handler: FriendSignalHandler) {
    this.friendRequestHandlers.add(handler);
    return () => this.friendRequestHandlers.delete(handler);
  }

  onFriendAccept(handler: FriendSignalHandler) {
    this.friendAcceptHandlers.add(handler);
    return () => this.friendAcceptHandlers.delete(handler);
  }

  onFriendRemove(handler: FriendSignalHandler) {
    this.friendRemoveHandlers.add(handler);
    return () => this.friendRemoveHandlers.delete(handler);
  }

  onStatusUpdate(handler: StatusUpdateHandler) {
    this.statusUpdateHandlers.add(handler);
    return () => this.statusUpdateHandlers.delete(handler);
  }

  onOnlineUsersList(handler: OnlineUsersListHandler) {
    this.onlineUsersListHandlers.add(handler);
    // Immediately call with cached data if available
    if (this.cachedOnlineUsers.size > 0) {
      handler(Array.from(this.cachedOnlineUsers));
    }
    return () => this.onlineUsersListHandlers.delete(handler);
  }

  onForceLogout(handler: ForceLogoutHandler) {
    this.forceLogoutHandlers.add(handler);
    return () => this.forceLogoutHandlers.delete(handler);
  }

  onDeliveryReceipt(handler: DeliveryReceiptHandler) {
    this.deliveryReceiptHandlers.add(handler);
    return () => this.deliveryReceiptHandlers.delete(handler);
  }

  onUserUpdate(handler: UserUpdateHandler) {
    this.userUpdateHandlers.add(handler);
    return () => this.userUpdateHandlers.delete(handler);
  }

  onAuthResult(handler: AuthResultHandler) {
    this.authResultHandlers.add(handler);
    return () => this.authResultHandlers.delete(handler);
  }

  onChangePassword(handler: ChangePasswordHandler) {
    this.changePasswordHandlers.add(handler);
    return () => this.changePasswordHandlers.delete(handler);
  }

  private updateState(newState: ConnectionState) {
    const oldState = this.state;
    this.state = newState;
    logger.info(
      "Network",
      `State changed: ${oldState} -> ${newState} (handlers: ${this.connectionHandlers.size})`,
    );
    this.connectionHandlers.forEach((h) => h(newState));
  }

  private notifyMessage(message: Message) {
    if (this.messageHandlers.size === 0) {
      // No active handlers yet (e.g. Dashboard not mounted); queue for later
      this.earlyMessages.push(message);
      return;
    }
    this.messageHandlers.forEach((h) => h(message));
  }

  private notifyAuthResult(result: { success: boolean; reason?: string }) {
    this.authResultHandlers.forEach((h) => h(result));
  }

  private notifyChangePassword(result: { success: boolean; reason?: string }) {
    // Resolve pending promises
    if (this.changePasswordPending.length > 0) {
      this.changePasswordPending.forEach((resolver) =>
        resolver({ success: !!result.success, reason: result.reason }),
      );
      this.changePasswordPending = [];
    }
    // Notify listeners
    this.changePasswordHandlers.forEach((h) =>
      h({ success: !!result.success, reason: result.reason }),
    );
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "PING" }));
      }
    }, SOCKET_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // For UI to know current endpoint
  getUrl(): string {
    return this.wsUrl;
  }
}

export const socketService = new SocketService();
