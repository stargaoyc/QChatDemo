// services/cryptoService.ts

// Utilities for converting ArrayBuffer to Base64 and back
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

class CryptoService {
  private keyPair: CryptoKeyPair | null = null;
  private sharedKeys: Map<string, CryptoKey> = new Map();
  private myPublicKeyStr: string | null = null;

  // Initialize keys (load from storage or generate new)
  async init(userId: string): Promise<string> {
    const storageKey = `qchat_keys_${userId}`;
    const storedKeys = localStorage.getItem(storageKey);

    if (storedKeys) {
      try {
        const { privateKeyJwk, publicKeyJwk } = JSON.parse(storedKeys);
        const privateKey = await window.crypto.subtle.importKey(
          "jwk",
          privateKeyJwk,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveKey", "deriveBits"],
        );
        const publicKey = await window.crypto.subtle.importKey(
          "jwk",
          publicKeyJwk,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          [],
        );
        this.keyPair = { privateKey, publicKey };
        this.myPublicKeyStr = JSON.stringify(publicKeyJwk);
        console.log("[Crypto] Keys loaded from storage");
        return this.myPublicKeyStr;
      } catch (e) {
        console.error("[Crypto] Failed to load keys, generating new ones", e);
      }
    }

    // Generate new keys
    this.keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"],
    );

    const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", this.keyPair.privateKey);

    localStorage.setItem(storageKey, JSON.stringify({ privateKeyJwk, publicKeyJwk }));
    this.myPublicKeyStr = JSON.stringify(publicKeyJwk);
    console.log("[Crypto] New keys generated");
    return this.myPublicKeyStr!;
  }

  getPublicKey(): string | null {
    return this.myPublicKeyStr;
  }

  // Compute shared secret with another user's public key
  async computeSharedSecret(otherUserId: string, otherPublicKeyStr: string): Promise<void> {
    if (!this.keyPair) throw new Error("Crypto service not initialized");

    try {
      const otherPublicKeyJwk = JSON.parse(otherPublicKeyStr);
      const otherPublicKey = await window.crypto.subtle.importKey(
        "jwk",
        otherPublicKeyJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );

      const sharedKey = await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: otherPublicKey },
        this.keyPair.privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );

      this.sharedKeys.set(otherUserId, sharedKey);
      console.log(`[Crypto] Shared secret established with ${otherUserId}`);
    } catch (e) {
      console.error(`[Crypto] Failed to compute shared secret for ${otherUserId}`, e);
    }
  }

  async encrypt(content: string, recipientId: string): Promise<string> {
    const key = this.sharedKeys.get(recipientId);
    if (!key) {
      throw new Error(`No shared key for ${recipientId}. Cannot encrypt.`);
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(content);

    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

    // Format: IV (base64) : Ciphertext (base64)
    // iv.buffer is ArrayBuffer; ciphertext is already ArrayBuffer
    return `${arrayBufferToBase64(iv.buffer)}:${arrayBufferToBase64(ciphertext)}`;
  }

  async decrypt(encryptedContent: string, senderId: string): Promise<string> {
    const key = this.sharedKeys.get(senderId);
    if (!key) {
      // If we don't have the key yet, we can't decrypt.
      // In a real app, we might request the public key again.
      // For now, return raw content or error.
      console.warn(`[Crypto] No shared key for ${senderId}, returning raw content.`);
      return encryptedContent;
    }

    try {
      const parts = encryptedContent.split(":");
      if (parts.length !== 2) return encryptedContent; // Not encrypted or invalid format

      const ivBuffer = base64ToArrayBuffer(parts[0]);
      const ciphertextBuffer = base64ToArrayBuffer(parts[1]);

      // Use Uint8Array for cross-platform compatibility (Node.js and browser)
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
        key,
        new Uint8Array(ciphertextBuffer),
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("[Crypto] Decryption failed", e);
      return "[Decryption Failed]";
    }
  }
}

export const cryptoService = new CryptoService();
