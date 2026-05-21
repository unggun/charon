import { describe, it, expect } from "vitest";
import { formatSol, formatPercent, formatMcap, truncateMint, formatRelativeTime, formatDuration } from "../src/lib/format";

describe("formatSol", () => {
  it("formats positive with + sign and 4 decimals", () => {
    expect(formatSol(0.1234)).toBe("+0.1234 SOL");
  });
  it("formats negative with - sign", () => {
    expect(formatSol(-0.5)).toBe("-0.5000 SOL");
  });
  it("formats zero without sign", () => {
    expect(formatSol(0)).toBe("0.0000 SOL");
  });
  it("formats null as em dash", () => {
    expect(formatSol(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats with + and 2 decimals", () => {
    expect(formatPercent(12.345)).toBe("+12.35%");
  });
  it("formats negative", () => {
    expect(formatPercent(-3.5)).toBe("-3.50%");
  });
  it("handles null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatMcap", () => {
  it("uses K for thousands", () => {
    expect(formatMcap(12_500)).toBe("$12.5K");
  });
  it("uses M for millions", () => {
    expect(formatMcap(2_400_000)).toBe("$2.4M");
  });
  it("uses plain dollars under 1k", () => {
    expect(formatMcap(850)).toBe("$850");
  });
  it("handles null", () => {
    expect(formatMcap(null)).toBe("—");
  });
});

describe("truncateMint", () => {
  it("shows first 4 and last 4 with ellipsis", () => {
    expect(truncateMint("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("ABCD…WXYZ");
  });
});

describe("formatRelativeTime", () => {
  it("formats seconds", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
  });
  it("formats minutes", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("formats hours", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("formats days", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("formatDuration", () => {
  it("formats short durations in minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
  });
  it("formats hours+minutes", () => {
    expect(formatDuration(2 * 3_600_000 + 30 * 60_000)).toBe("2h 30m");
  });
});
