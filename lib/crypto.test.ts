import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto";

describe("crypto (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.SIMPLEFIN_ENC_KEY = randomBytes(32).toString("hex");
  });

  it("round-trips a value", () => {
    const secret = "https://user:pass@bridge.simplefin.org/simplefin";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("produces a fresh IV each time", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });

  it("rejects a tampered ciphertext", () => {
    const enc = encrypt("secret");
    const [iv, tag, data] = enc.split(":");
    const flipped = data.slice(0, -1) + (data.slice(-1) === "0" ? "1" : "0");
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });
});
