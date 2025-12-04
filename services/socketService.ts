
import { Message, User } from '../types';
import { logger } from './logger';
import { SOCKET_HEARTBEAT_INTERVAL } from '../constants';

type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';

type MessageHandler = (message: Message) => void;
type ConnectionHandler = (state: ConnectionState) => void;
type FriendSignalHandler = (payload: any) => void;
type StatusUpdateHandler = (userId: string, status: string) => void;
type ForceLogoutHandler = () => void;
type OnlineUsersListHandler = (userIds: string[]) => void;
type DeliveryReceiptHandler = (messageId: string) => void;

class SocketService {
  private state: ConnectionState = 'DISCONNECTED';
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  
  private friendRequestHandlers: Set<FriendSignalHandler> = new Set();
  private friendAcceptHandlers: Set<FriendSignalHandler> = new Set();
  private friendRemoveHandlers: Set<FriendSignalHandler> = new Set();
  private statusUpdateHandlers: Set<StatusUpdateHandler> = new Set();
  private forceLogoutHandlers: Set<ForceLogoutHandler> = new Set();
  private onlineUsersListHandlers: Set<OnlineUsersListHandler> = new Set();
  private deliveryReceiptHandlers: Set<DeliveryReceiptHandler> = new Set();
  
  // Cache for online users to handle race conditions
  private cachedOnlineUsers: Set<string> = new Set();

  private heartbeatTimer: any = null;
  private socket: WebSocket | null = null;
  
  // Connection Logic
  private endpointList: string[] = [];
  private currentEndpointIndex: number = 0;
  private connectionTimeoutId: any = null;
  private wsUrl: string = ''; // Current URL for reference

  private currentUser: User | null = null;
    // Cache messages received before any UI handler is attached
    private earlyMessages: Message[] = [];
  
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
      const hostRegex = /^((25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3})$|^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$|^localhost$/;

      const rawHost = host ? host.trim() : '';
      let finalHost = rawHost;
      let finalPort = port && String(port).trim() ? port : null;

      // Support 'IP:port' or 'Domain:port' in host field
      if (rawHost && rawHost.includes(':') && !finalPort) {
          const parts = rawHost.split(':');
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
          this.endpointList.push('ws://localhost:8080');
          // 2. Hardcoded Fallback
          this.endpointList.push('ws://103.40.14.123:58080');
      }
      
      logger.info('Network', `Configured endpoints: ${JSON.stringify(this.endpointList)}`);
  }

  connect(user: User) {
    if (this.state === 'CONNECTED') return;
    this.currentUser = user;
    this.currentEndpointIndex = 0;
    
    // If no endpoints configured (shouldn't happen if configureServer called, but safety check)
    if (this.endpointList.length === 0) {
        this.configureServer(); // Load defaults
    }

    this.tryNextEndpoint();
  }

  private async tryNextEndpoint() {
      if (this.currentEndpointIndex >= this.endpointList.length) {
          logger.error('Network', 'All connection endpoints failed.');
          this.updateState('DISCONNECTED');
          return;
      }

      let url = this.endpointList[this.currentEndpointIndex];
      this.updateState('CONNECTING');
      logger.info('Network', `Connecting to ${url} (${this.currentEndpointIndex + 1}/${this.endpointList.length})...`);

      // Check if URL contains a domain that needs resolution
      // Format: ws://host:port
      try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname;
          const port = urlObj.port;
          
          // If hostname is not an IP address (and not localhost, though localhost is fine to resolve too, but usually handled by OS)
          // Simple check: if it contains letters and is not localhost
          const isIp = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
          
          if (!isIp && hostname !== 'localhost') {
              logger.info('Network', `Resolving domain ${hostname}...`);
              // Call Main Process to resolve DNS
              const resolvedIp = await (window as any).electronAPI.invoke('net:resolve-dns', hostname);
              
              if (resolvedIp) {
                  logger.info('Network', `Resolved ${hostname} -> ${resolvedIp}`);
                  // Reconstruct URL with IP
                  url = `ws://${resolvedIp}:${port}`;
              } else {
                  logger.warn('Network', `Failed to resolve domain ${hostname}, trying original URL.`);
              }
          }
      } catch (e) {
          logger.warn('Network', `Error parsing/resolving URL ${url}:`, e);
      }

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
                  logger.warn('Network', `Connection to ${url} timed out.`);
                  // Closing the socket will trigger onclose, which handles the next step
                  this.socket?.close(); 
              }
          }, 3000); // 3s timeout

          this.socket.onopen = () => {
              clearTimeout(this.connectionTimeoutId);
              logger.info('Network', `WebSocket Connected to ${url}`);
              this.updateState('CONNECTED');
              this.startHeartbeat();
              
              // Authenticate
              if (this.currentUser) {
                  this.socket?.send(JSON.stringify({
                      type: 'AUTH',
                      userId: this.currentUser.id,
                      username: this.currentUser.username
                  }));
              }
          };

          this.socket.onmessage = (event) => {
              try {
                  const data = JSON.parse(event.data);
                  if (data.type === 'PONG') return;

                  if (data.type === 'FORCE_LOGOUT') {
                      logger.warn('Network', 'Received FORCE_LOGOUT');
                      this.disconnect();
                      this.forceLogoutHandlers.forEach(h => h());
                      return;
                  }

                  if (data.type === 'CHAT') {
                      this.notifyMessage(data.payload as Message);
                  }
                  if (data.type === 'FRIEND_REQUEST') {
                      this.friendRequestHandlers.forEach(h => h(data.payload));
                  }
                  if (data.type === 'FRIEND_ACCEPT') {
                      this.friendAcceptHandlers.forEach(h => h(data.payload));
                  }
                  if (data.type === 'FRIEND_REMOVE') {
                      this.friendRemoveHandlers.forEach(h => h(data.payload));
                  }
                  if (data.type === 'STATUS_UPDATE') {
                      if (data.status === 'online') {
                          this.cachedOnlineUsers.add(data.userId);
                      } else {
                          this.cachedOnlineUsers.delete(data.userId);
                      }
                      this.statusUpdateHandlers.forEach(h => h(data.userId, data.status));
                  }
                  if (data.type === 'ONLINE_USERS_LIST') {
                      this.cachedOnlineUsers = new Set(data.userIds);
                      this.onlineUsersListHandlers.forEach(h => h(data.userIds));
                  }
                  if (data.type === 'MESSAGE_DELIVERED') {
                      this.deliveryReceiptHandlers.forEach(h => h(data.payload.messageId));
                  }
              } catch (err) {
                  logger.error('Network', 'Failed to parse message', err);
              }
          };

          this.socket.onclose = () => {
              clearTimeout(this.connectionTimeoutId);
              this.stopHeartbeat();
              
              if (this.state === 'CONNECTED') {
                  // Was connected, now disconnected unexpectedly
                  this.updateState('DISCONNECTED');
                  logger.warn('Network', 'Socket closed unexpectedly.');
              } else {
                  // Was connecting, failed. Try next endpoint.
                  logger.warn('Network', `Failed to connect to ${url}.`);
                  this.currentEndpointIndex++;
                  this.tryNextEndpoint();
              }
          };

          this.socket.onerror = (_err) => {
              // Error usually precedes close. We let onclose handle the logic.
              logger.error('Network', `Socket error with ${url}`);
          };

      } catch (e) {
          logger.error('Network', 'Connection failed immediately', e);
          this.currentEndpointIndex++;
          this.tryNextEndpoint();
      }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.connectionTimeoutId) clearTimeout(this.connectionTimeoutId);
    if (this.socket) {
        // Prevent onclose from triggering next endpoint if we manually disconnect
        this.socket.onclose = null; 
        this.socket.close();
        this.socket = null;
    }
    this.updateState('DISCONNECTED');
    this.currentUser = null;
    this.cachedOnlineUsers.clear();
  }

  async sendMessage(message: Message, recipientId: string) {
      if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
              type: 'CHAT',
              targetUserId: recipientId,
              payload: message
          }));
      } else {
          logger.error('Network', 'Cannot send message: Socket not open');
          throw new Error('Network disconnected');
      }
  }

  async sendDeliveryReceipt(messageId: string, recipientId: string) {
      if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
              type: 'MESSAGE_DELIVERED',
              targetUserId: recipientId,
              payload: { messageId }
          }));
      }
  }

  // --- Friend Signal Methods ---

  async sendFriendRequest(targetUserId: string, currentUser: User) {
      if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
              type: 'FRIEND_REQUEST',
              targetUserId: targetUserId,
              payload: { fromUser: currentUser, timestamp: Date.now() }
          }));
      } else {
          throw new Error('Network disconnected');
      }
  }

  async acceptFriendRequest(targetUserId: string, currentUser: User) {
      if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
              type: 'FRIEND_ACCEPT',
              targetUserId: targetUserId,
              payload: { user: currentUser }
          }));
      }
  }

  async removeFriend(targetUserId: string) {
      if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
              type: 'FRIEND_REMOVE',
              targetUserId: targetUserId,
              payload: { userId: this.currentUser?.id }
          }));
      }
  }

  // --- Listeners ---

  onMessage(handler: MessageHandler) {
        this.messageHandlers.add(handler);
        // Immediately replay any messages that arrived before handler registration
        if (this.earlyMessages.length > 0) {
            this.earlyMessages.forEach(m => handler(m));
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

  private updateState(newState: ConnectionState) {
    this.state = newState;
    this.connectionHandlers.forEach(h => h(newState));
  }

  private notifyMessage(message: Message) {
        if (this.messageHandlers.size === 0) {
            // No active handlers yet (e.g. Dashboard not mounted); queue for later
            this.earlyMessages.push(message);
            return;
        }
        this.messageHandlers.forEach(h => h(message));
  }

  private startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
              this.socket.send(JSON.stringify({ type: 'PING' }));
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
