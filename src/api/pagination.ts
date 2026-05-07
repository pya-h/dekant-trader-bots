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

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
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

  const pageSize = Math.min(requestedPageSize, defaults.maxPageSize);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize
  };
}
