import { describe, expect, it } from "vitest";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";

describe("formatBytes", () => {
  it("keeps small values in bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });
  it("converts to MB/GB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
  it("renders null as em-dash", () => {
    expect(formatBytes(null)).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it("formats as m:ss", () => {
    expect(formatDurationMs(65_000)).toBe("1:05");
    expect(formatDurationMs(9_000)).toBe("0:09");
  });
  it("renders null as em-dash", () => {
    expect(formatDurationMs(null)).toBe("—");
  });
});

describe("formatResolution", () => {
  it("joins width and height", () => {
    expect(formatResolution(1080, 1920)).toBe("1080×1920");
  });
  it("renders em-dash when either dimension is missing", () => {
    expect(formatResolution(null, 1920)).toBe("—");
    expect(formatResolution(1080, null)).toBe("—");
  });
});
