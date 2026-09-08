import { describe, expect, it } from "vitest";
import { sha256Buffer } from "@/lib/media/hash";
import { detectAndValidateMime } from "@/lib/media/mime";
import { isAllowedMimeType, getMaxUploadSizeBytes } from "@/lib/media/limits";

// 1x1 transparent PNG — fixture real e mínima (magic bytes válidos de verdade,
// não um mock que finge ser um arquivo).
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("sha256Buffer", () => {
  it("is deterministic for the same input", () => {
    const buf = Buffer.from("pitchat");
    expect(sha256Buffer(buf)).toBe(sha256Buffer(Buffer.from("pitchat")));
  });

  it("produces a 64-char lowercase hex digest", () => {
    const digest = sha256Buffer(Buffer.from("pitchat"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs (no trivial collision)", () => {
    expect(sha256Buffer(Buffer.from("a"))).not.toBe(sha256Buffer(Buffer.from("b")));
  });

  it("matches the known SHA-256 of an empty buffer", () => {
    expect(sha256Buffer(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("isAllowedMimeType / getMaxUploadSizeBytes", () => {
  it("allows the V1 video/image types and nothing else", () => {
    expect(isAllowedMimeType("video/mp4")).toBe(true);
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("application/pdf")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
  });

  it("defaults the upload limit to 500MB when env is unset", () => {
    expect(getMaxUploadSizeBytes()).toBe(500 * 1024 * 1024);
  });
});

describe("detectAndValidateMime", () => {
  it("detects a real PNG by magic bytes, not by extension/content-type", async () => {
    const png = Buffer.from(MINIMAL_PNG_BASE64, "base64");
    const result = await detectAndValidateMime(png);
    expect(result).toEqual({ ok: true, mimeType: "image/png" });
  });

  it("rejects a file whose real type isn't in the allowlist (magic bytes still detected)", async () => {
    const gifHeader = Buffer.from("GIF89a", "ascii");
    const result = await detectAndValidateMime(gifHeader);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_ALLOWED");
      expect(result.detectedMimeType).toBe("image/gif");
    }
  });

  it("rejects garbage bytes as undetectable rather than guessing", async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const result = await detectAndValidateMime(garbage);
    expect(result).toEqual({ ok: false, reason: "UNDETECTABLE" });
  });

  it("never trusts a spoofed extension: renaming garbage to .mp4 changes nothing", async () => {
    // O nome do arquivo nem entra na função — só o conteúdo importa. Esse
    // teste documenta a garantia (regra 27 do briefing: filename não define
    // identidade nem tipo).
    const garbagePretendingToBeMp4 = Buffer.from("not actually a video file");
    const result = await detectAndValidateMime(garbagePretendingToBeMp4);
    expect(result.ok).toBe(false);
  });
});
