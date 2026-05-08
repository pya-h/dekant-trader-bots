export type Pagination = {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
};

export type PaginationDefaults = {
  page: number;
  pageSize: number;
  maxPageSize: number;
};

const DEFAULTS: PaginationDefaults = {
  page: 1,
  pageSize: 50,
  maxPageSize: 200
};

const MAX_LIMIT = 1000;
const MAX_OFFSET = 1_000_000;

function parsePositiveInt(value: unknown): number | null {
  // Reject Infinity / scientific-notation / non-finite values by going through
  // parseInt-on-string and Number.isSafeInteger.
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = parseInt(trimmed, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function parsePaginationQuery(
  query: { page?: unknown; page_size?: unknown },
  defaults: PaginationDefaults = DEFAULTS
): Pagination {
  const page = query.page === undefined ? defaults.page : parsePositiveInt(query.page);
  if (page === null) {
    throw new Error("invalid_page");
  }

  const requestedPageSize = query.page_size === undefined ? defaults.pageSize : parsePositiveInt(query.page_size);
  if (requestedPageSize === null) {
    throw new Error("invalid_page_size");
  }

  const pageSize = Math.min(requestedPageSize, defaults.maxPageSize, MAX_LIMIT);
  const offset = (page - 1) * pageSize;
  if (offset > MAX_OFFSET) {
    throw new Error("invalid_page");
  }

  return {
    page,
    pageSize,
    offset,
    limit: pageSize
  };
}
