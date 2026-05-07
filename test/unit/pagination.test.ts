import { describe, expect, it } from "vitest";
import { parsePaginationQuery } from "../../src/api/pagination.js";

describe("parsePaginationQuery", () => {
  it("uses safe defaults when pagination query is omitted", () => {
    const parsed = parsePaginationQuery({});

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(parsed.limit).toBe(50);
  });

  it("parses explicit page and page_size values", () => {
    const parsed = parsePaginationQuery({ page: "3", page_size: "20" });

    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.offset).toBe(40);
    expect(parsed.limit).toBe(20);
  });

  it("rejects invalid pagination values", () => {
    expect(() => parsePaginationQuery({ page: "0" })).toThrow("invalid_page");
    expect(() => parsePaginationQuery({ page_size: "-1" })).toThrow("invalid_page_size");
  });
});
