// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Setup global window mock BEFORE importing storageService
if (typeof globalThis.window === "undefined") {
  // @ts-ignore
  globalThis.window = {};
}

import { storageService } from "../../services/storageService";
import { User } from "../../types";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
});

// Mock Electron API
const electronAPIMock = {
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn(),
};

describe("StorageService", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset internal state of storageService if possible,
    // but it's a singleton. We might need to access private fields or just rely on public API.
    // For testing purposes, we can force "Browser Mode" by ensuring window.electronAPI is undefined
    // or "Electron Mode" by defining it.
  });

  describe("Browser Mode", () => {
    beforeEach(() => {
      // @ts-ignore
      delete globalThis.window.electronAPI;
      // Re-instantiate or reset if needed.
      // Since it's a singleton instantiated at module level, we can't easily reset the `isElectron` flag
      // which is set in constructor.
      // However, we can modify the private property if we cast to any.
      (storageService as any).isElectron = false;
      (storageService as any).currentUserId = null;
    });

    it("should save and retrieve items from localStorage", async () => {
      const user: User = { id: "u1", username: "test", status: "online" };
      await storageService.setCurrentUser(user);

      const retrieved = await storageService.getCurrentUser();
      expect(retrieved).toEqual(user);
      expect(localStorage.getItem("orbit_current_user")).toContain("u1");
    });

    it("should prefix keys with userId when logged in", async () => {
      const user: User = { id: "u1", username: "test", status: "online" };
      await storageService.setCurrentUser(user);

      await storageService.saveMessage({ id: "m1", content: "hi" } as any);

      // Check raw localStorage for prefixed key
      // The key logic in storageService: if (this.currentUserId) return `${this.currentUserId}_${key}`;
      // KEY_MESSAGES = 'orbit_messages'
      const raw = localStorage.getItem("u1_orbit_messages");
      expect(raw).toBeTruthy();
      expect(raw).toContain("m1");
    });
  });

  describe("Electron Mode", () => {
    beforeEach(() => {
      // @ts-ignore
      globalThis.window.electronAPI = electronAPIMock;
      (storageService as any).isElectron = true;
      (storageService as any).currentUserId = null;
    });

    it("should invoke electronAPI for storage operations", async () => {
      const user: User = { id: "u2", username: "electron_user", status: "online" };

      // Mock db:set and db:get
      electronAPIMock.invoke.mockImplementation(async (channel, ...args) => {
        if (channel === "db:get" && args[0] === "orbit_current_user") return user;
        return null;
      });

      await storageService.setCurrentUser(user);
      expect(electronAPIMock.invoke).toHaveBeenCalledWith("auth:login", "u2");
      expect(electronAPIMock.invoke).toHaveBeenCalledWith(
        "db:set",
        expect.objectContaining({
          key: "orbit_current_user",
          value: user,
        }),
      );
    });
  });
});
