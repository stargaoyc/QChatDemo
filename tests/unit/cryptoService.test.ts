// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { cryptoService } from "../../services/cryptoService";

// Mock window.crypto for Node environment if needed
// But Vitest with jsdom might handle it.
// If not, we can use Node's webcrypto.
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}
if (!globalThis.window) {
  // @ts-ignore
  globalThis.window = {
    crypto: webcrypto,
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    atob: (str) => Buffer.from(str, "base64").toString("binary"),
  };
} else {
  if (!window.crypto) {
    // @ts-ignore
    window.crypto = webcrypto;
  }
}

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

describe("CryptoService", () => {
  it("should generate keys and encrypt/decrypt", async () => {
    // User A
    const serviceA = new (cryptoService.constructor as any)();
    const pubA = await serviceA.init("userA");

    // User B
    const serviceB = new (cryptoService.constructor as any)();
    const pubB = await serviceB.init("userB");

    // Exchange keys
    await serviceA.computeSharedSecret("userB", pubB);
    await serviceB.computeSharedSecret("userA", pubA);

    // Encrypt A -> B
    const msg = "Hello Secret World";
    const encrypted = await serviceA.encrypt(msg, "userB");
    expect(encrypted).not.toBe(msg);
    expect(encrypted).toContain(":"); // IV:Ciphertext

    // Decrypt B
    const decrypted = await serviceB.decrypt(encrypted, "userA");
    expect(decrypted).toBe(msg);
  });
});
