export enum MessageStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
}

export enum MessageType {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
}

export interface User {
  id: string;
  username: string;
  avatarUrl?: string;
  status: "online" | "offline" | "busy";
  lastSeen?: number;
  publicKey?: string; // JWK string for ECDH
}

export interface FriendRequest {
  fromUser: User;
  timestamp: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string; // Text content or Base64 image string
  type: MessageType;
  status: MessageStatus;
  timestamp: number;
}

export interface Conversation {
  id: string;
  participantId: string; // The other person
  unreadCount: number;
  lastMessage?: Message;
  updatedAt: number;
}

export interface AppSettings {
  theme: "light" | "dark";
  notificationsEnabled: boolean;
  logLevel: "info" | "warn" | "error";
  // Optional server configuration for signaling
  serverHost?: string;
  serverPort?: number;
}

// Event types for our mock socket
export interface SocketEvent {
  type: "MESSAGE_RECEIVED" | "STATUS_UPDATE" | "CONNECT" | "DISCONNECT";
  payload?: any;
}

// Global Window Extension for Electron
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: any) => Promise<any>;
      on: (channel: string, func: (...args: any[]) => void) => void;
    };
  }
}
