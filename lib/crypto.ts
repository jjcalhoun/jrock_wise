import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* AES-256-GCM encryption for secrets at rest (the SimpleFIN access URL).
   Used ONLY in server route handlers — never imported into client code.
   The key comes from SIMPLEFIN_ENC_KEY: a 32-byte key, hex (64 chars) or
   base64-encoded. Ciphertext is stored as "iv:tag:data", all hex. */

function getKey(): Buffer {
  const raw = process.env.SIMPLEFIN_ENC_KEY;
  if (!raw) throw new Error("SIMPLEFIN_ENC_KEY is not set");
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SIMPLEFIN_ENC_KEY must decode to 32 bytes");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
