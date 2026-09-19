import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

function masterKey(): Buffer {
  const raw = process.env.EXECUTION_MASTER_KEY;
  if (!raw) {
    throw new Error("EXECUTION_MASTER_KEY is not configured");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "EXECUTION_MASTER_KEY must be exactly 32 random bytes encoded as base64",
    );
  }

  return key;
}

export function encryptSecret(secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(secret)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(value: string): Uint8Array {
  const [version, ivB64, tagB64, ciphertextB64] = value.split(".");
  if (
    version !== "v1" ||
    !ivB64 ||
    !tagB64 ||
    !ciphertextB64
  ) {
    throw new Error("Invalid encrypted wallet secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const clear = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);

  return new Uint8Array(clear);
}
