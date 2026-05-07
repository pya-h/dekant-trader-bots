export class HttpResponseError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.body = body;
  }
}

export type RequestJsonOptions = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (status: number) => boolean;
};

function defaultShouldRetry(status: number): boolean {
  return status >= 500;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Fetch aborts and transient network failures are retriable.
  return error.name === "AbortError" || error.name === "TypeError";
}

function normalizeHeaders(
  inputHeaders: Record<string, string> | undefined,
  hasBody: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(inputHeaders ?? {})
  };

  if (hasBody && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

async function parseResponseOrThrow<T>(
  response: Response,
  shouldRetry: (status: number) => boolean
): Promise<T> {
  if (!response.ok) {
    const body = await response.text();

    if (shouldRetry(response.status)) {
      throw new HttpResponseError(
        `Retriable HTTP response (${response.status})`,
        response.status,
        body
      );
    }

    throw new HttpResponseError(`HTTP response error (${response.status})`, response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  if (!raw) {
    return undefined as T;
  }

  return JSON.parse(raw) as T;
}

export async function requestJsonWithRetry<T>(options: RequestJsonOptions): Promise<T> {
  const {
    url,
    method = "GET",
    headers,
    body,
    timeoutMs,
    retryCount,
    retryBackoffMs,
    fetchImpl = fetch,
    sleep = defaultSleep,
    shouldRetry = defaultShouldRetry
  } = options;

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders = normalizeHeaders(headers, payload !== undefined);

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retryCount) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: payload,
        signal: controller.signal
      });
      clearTimeout(timeout);

      return await parseResponseOrThrow<T>(response, shouldRetry);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      const shouldRetryAttempt =
        attempt < retryCount &&
        (error instanceof HttpResponseError
          ? shouldRetry(error.status)
          : isRetriableNetworkError(error));

      if (!shouldRetryAttempt) {
        throw error;
      }

      attempt += 1;
      await sleep(retryBackoffMs * attempt);
    }
  }

  throw lastError;
}
