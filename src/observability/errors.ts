import { HttpResponseError } from "../clients/http-client.js";

export type ErrorType =
  | "validation"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "network"
  | "unknown";

export type ClassifiedError = {
  type: ErrorType;
  message: string;
  known: boolean;
  retryable: boolean;
  statusCode?: number;
};

const VALIDATION_ERROR_CODES = new Set([
  "invalid_payload",
  "invalid_page",
  "invalid_page_size",
  "count_must_be_positive",
  "manual_amount_must_be_positive",
  "bot_not_found",
  "buy_engine_unavailable",
  "sell_engine_unavailable",
  "balances_unavailable",
  "funding_unavailable",
  "stats_unavailable",
  "market_control_unavailable",
  "config_update_unavailable"
]);

function fromHttpError(error: HttpResponseError): ClassifiedError {
  if (error.status === 401 || error.status === 403) {
    return {
      type: "unauthorized",
      message: error.message,
      known: true,
      retryable: false,
      statusCode: error.status
    };
  }

  if (error.status === 404) {
    return {
      type: "not_found",
      message: error.message,
      known: true,
      retryable: false,
      statusCode: error.status
    };
  }

  if (error.status === 409) {
    return {
      type: "conflict",
      message: error.message,
      known: true,
      retryable: false,
      statusCode: error.status
    };
  }

  if (error.status === 429) {
    return {
      type: "rate_limited",
      message: error.message,
      known: true,
      retryable: true,
      statusCode: error.status
    };
  }

  if (error.status === 408) {
    return {
      type: "upstream_timeout",
      message: error.message,
      known: true,
      retryable: true,
      statusCode: error.status
    };
  }

  if (error.status >= 500) {
    return {
      type: "upstream_unavailable",
      message: error.message,
      known: true,
      retryable: true,
      statusCode: error.status
    };
  }

  if (error.status >= 400) {
    return {
      type: "validation",
      message: error.message,
      known: true,
      retryable: false,
      statusCode: error.status
    };
  }

  return {
    type: "unknown",
    message: error.message,
    known: false,
    retryable: false,
    statusCode: error.status
  };
}

function fromKnownMessage(message: string): ClassifiedError {
  return {
    type: "validation",
    message,
    known: true,
    retryable: false
  };
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof HttpResponseError) {
    return fromHttpError(error);
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return {
        type: "upstream_timeout",
        message: error.message,
        known: true,
        retryable: true
      };
    }

    if (error.name === "TypeError") {
      return {
        type: "network",
        message: error.message,
        known: true,
        retryable: true
      };
    }

    if (VALIDATION_ERROR_CODES.has(error.message) || error.message.startsWith("invalid_")) {
      return fromKnownMessage(error.message);
    }

    return {
      type: "unknown",
      message: error.message,
      known: false,
      retryable: false
    };
  }

  if (typeof error === "string") {
    if (VALIDATION_ERROR_CODES.has(error) || error.startsWith("invalid_")) {
      return fromKnownMessage(error);
    }

    return {
      type: "unknown",
      message: error,
      known: false,
      retryable: false
    };
  }

  return {
    type: "unknown",
    message: "unknown_error",
    known: false,
    retryable: false
  };
}
