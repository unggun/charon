import { describe, it, expect } from "vitest";
import { parseFilters, serializeFilters } from "../src/lib/filters";

describe("parseFilters", () => {
  it("returns empty object when no params", () => {
    expect(parseFilters(new URLSearchParams())).toEqual({});
  });

  it("parses date range", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-01-31");
    expect(parseFilters(params)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("rejects invalid date format", () => {
    expect(parseFilters(new URLSearchParams("from=2026/01/01"))).toEqual({});
  });

  it("parses lastN as integer", () => {
    expect(parseFilters(new URLSearchParams("lastN=50"))).toEqual({ lastN: 50 });
  });

  it("ignores non-numeric lastN", () => {
    expect(parseFilters(new URLSearchParams("lastN=abc"))).toEqual({});
  });

  it("date range takes precedence over lastN if both present", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-01-31&lastN=50");
    const result = parseFilters(params);
    expect(result.from).toBe("2026-01-01");
    expect(result.lastN).toBeUndefined();
  });

  it("parses strategy and mode", () => {
    const params = new URLSearchParams("strategy=sniper&mode=dry_run");
    expect(parseFilters(params)).toMatchObject({
      strategy: "sniper",
      mode: "dry_run",
    });
  });

  it("defaults invalid mode to omitted", () => {
    expect(parseFilters(new URLSearchParams("mode=garbage"))).toEqual({});
  });
});

describe("serializeFilters", () => {
  it("returns empty string when no filters", () => {
    expect(serializeFilters({})).toBe("");
  });

  it("omits undefined values", () => {
    expect(serializeFilters({ from: "2026-01-01", to: undefined })).toBe("from=2026-01-01");
  });

  it("serializes all filter keys", () => {
    const s = serializeFilters({
      from: "2026-01-01",
      to: "2026-01-31",
      strategy: "sniper",
      mode: "dry_run",
    });
    const parsed = Object.fromEntries(new URLSearchParams(s));
    expect(parsed).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      strategy: "sniper",
      mode: "dry_run",
    });
  });
});
