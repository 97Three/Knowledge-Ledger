import { describe, expect, it } from "vitest";
import { formatRelativeTime, percent, shortId, shortRevision } from "./format";

describe("formatRelativeTime", () => {
  it("returns a dash for missing or invalid input", () => {
    expect(formatRelativeTime(undefined)).toBe("—");
    expect(formatRelativeTime("")).toBe("—");
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("describes recent timestamps in Chinese", () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("刚刚");
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toBe("3 小时前");
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe("2 天前");
  });
});

describe("shortRevision", () => {
  it("renders a readable revision fingerprint", () => {
    const revision = `urn:nian:sha256:7f3ac92e1b04${"0".repeat(52)}`;
    expect(shortRevision(revision)).toBe("7f3a·c92e");
  });

  it("keeps short values untouched", () => {
    expect(shortRevision("rev-1")).toBe("rev-1");
    expect(shortRevision(undefined)).toBe("—");
  });
});

describe("shortId", () => {
  it("truncates long identifiers with an ellipsis", () => {
    expect(shortId("https://knowledge.local/spaces/support-core", 18)).toBe("https://knowledge…");
  });
});

describe("percent", () => {
  it("never divides by zero", () => {
    expect(percent(3, 0)).toBe("0%");
    expect(percent(3, 4)).toBe("75%");
  });
});
