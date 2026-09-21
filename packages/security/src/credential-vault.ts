export interface CredentialContext {
  tenantId: string;
  shopId: string;
  version: number;
}

export interface EncryptedCredential {
  algorithm: "AES-GCM-256";
  nonce: string;
  ciphertext: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function additionalData(context: CredentialContext): Uint8Array {
  return encoder.encode(`auto-etsy-seo:credential:v1:${context.tenantId}:${context.shopId}:${context.version}`);
}

export class CredentialVault {
  private readonly key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.key = key;
  }

  static async fromRawKey(raw: Uint8Array): Promise<CredentialVault> {
    if (raw.byteLength !== 32) throw new Error("credential_key_must_be_32_bytes");
    const key = await crypto.subtle.importKey("raw", bufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return new CredentialVault(key);
  }

  static async fromBase64Key(value: string): Promise<CredentialVault> {
    return CredentialVault.fromRawKey(fromBase64(value));
  }

  async encrypt(plaintext: string, context: CredentialContext): Promise<EncryptedCredential> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bufferSource(nonce), additionalData: bufferSource(additionalData(context)), tagLength: 128 },
      this.key,
      encoder.encode(plaintext),
    );
    return { algorithm: "AES-GCM-256", nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  }

  async decrypt(encrypted: EncryptedCredential, context: CredentialContext): Promise<string> {
    if (encrypted.algorithm !== "AES-GCM-256") throw new Error("credential_algorithm_unsupported");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(fromBase64(encrypted.nonce)), additionalData: bufferSource(additionalData(context)), tagLength: 128 },
      this.key,
      bufferSource(fromBase64(encrypted.ciphertext)),
    );
    return decoder.decode(plaintext);
  }
}
