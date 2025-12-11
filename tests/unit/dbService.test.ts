import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mockDataSource, mockRepo } from "../../__mocks__/typeorm";
import * as typeorm from "typeorm";
import { KvEntity } from "../../electron/entities";

// Mock typeorm
vi.mock("typeorm", () => {
  const mocks = require("../../__mocks__/typeorm");
  return {
    ...mocks,
    default: mocks,
  };
});

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  };
});

describe("DbService", () => {
  let dbService: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset mock state
    mockDataSource.initialize = vi.fn().mockResolvedValue(true);
    mockDataSource.getRepository = vi.fn().mockReturnValue(mockRepo);
    mockRepo.findOneBy = vi.fn();
    mockRepo.save = vi.fn().mockResolvedValue(true);

    // Dynamic import to ensure mocks are applied
    const module = await import("../../electron/dbService");
    const DbServiceClass = module.DbService;

    const mockApp = {
      getPath: vi.fn(() => "mock-user-data-path"),
    };

    dbService = new DbServiceClass(mockApp, (typeorm as any).DataSource);

    // Reset internal state
    if (dbService) {
      (dbService as any).globalDataSource = null;
      (dbService as any).userDataSource = null;
    }
  });

  it("should initialize global database on first access", async () => {
    const mockRepo = await (dbService as any).getGlobalRepo();
    expect(mockDataSource.initialize).toHaveBeenCalled();
    expect(mockDataSource.getRepository).toHaveBeenCalledWith(KvEntity);
  });

  it("should get value from global store", async () => {
    mockRepo.findOneBy.mockResolvedValue({ key: "test", valueJson: JSON.stringify("value") });

    const val = await dbService.getGlobal("test");
    expect(val).toBe("value");
    expect(mockRepo.findOneBy).toHaveBeenCalledWith({ key: "test" });
  });

  it("should set value in global store", async () => {
    await dbService.setGlobal("test", "value");
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "test",
        valueJson: JSON.stringify("value"),
      }),
    );
  });

  it("should switch user database", async () => {
    await dbService.openUserDb("user1");
    expect(mockDataSource.initialize).toHaveBeenCalled();
    expect((dbService as any).userDataSource).toBeDefined();
  });
});
