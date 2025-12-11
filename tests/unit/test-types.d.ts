// Type declarations for JavaScript modules used in tests

declare module "../../__mocks__/typeorm" {
  export const mockDataSource: any;
  export const mockRepo: any;
  export const DataSource: any;
}

declare module "../../electron/entities" {
  export const KvEntity: any;
  export const ConversationEntity: any;
  export const MessageEntity: any;
}

declare module "../../electron/dbService" {
  export class DbService {
    constructor(app: any, DataSourceClass: any);
    initGlobalDb(): Promise<void>;
    initUserDb(userId: string): Promise<void>;
    getGlobalRepo(entity: any): any;
    getUserRepo(entity: any): any;
    upsertConversation(conv: any): Promise<void>;
  }
}

declare module "../../server/index.js" {
  import { WebSocketServer } from "ws";
  export function startServer(port: number, host?: string): WebSocketServer;
}
