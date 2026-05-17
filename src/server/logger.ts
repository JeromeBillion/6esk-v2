import { randomUUID } from "crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;
type Logger = {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  child(defaults: LogContext): Logger;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function resolveMinLevel(): LogLevel {
  const defaultLevel = process.env.NODE_ENV === "test" ? "error" : "info";
  const envLevel = (process.env.LOG_LEVEL ?? defaultLevel).toLowerCase();
  if (envLevel in LOG_LEVEL_ORDER) return envLevel as LogLevel;
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  const minLevel = resolveMinLevel();
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];
}

function formatError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return String(value);
}

function serializeError(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }
  return {
    message: formatError(value)
  };
}

function emit(level: LogLevel, msg: string, context?: LogContext) {
  if (!shouldLog(level)) return;

  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...context
  };

  if (entry.error !== undefined) {
    entry.error = serializeError(entry.error);
  }

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

function childLogger(defaults: LogContext): Logger {
  return {
    debug(msg: string, context?: LogContext) {
      emit("debug", msg, { ...defaults, ...context });
    },
    info(msg: string, context?: LogContext) {
      emit("info", msg, { ...defaults, ...context });
    },
    warn(msg: string, context?: LogContext) {
      emit("warn", msg, { ...defaults, ...context });
    },
    error(msg: string, context?: LogContext) {
      emit("error", msg, { ...defaults, ...context });
    },
    child(moreDefaults: LogContext) {
      return childLogger({ ...defaults, ...moreDefaults });
    }
  };
}

export function getRequestId(request: Request) {
  return (
    request.headers.get("x-request-id")?.trim() ||
    request.headers.get("x-correlation-id")?.trim() ||
    request.headers.get("cf-ray")?.trim() ||
    randomUUID()
  );
}

export function getRequestContext(request: Request, context: LogContext = {}) {
  const url = new URL(request.url);
  return {
    requestId: getRequestId(request),
    method: request.method,
    path: url.pathname,
    ...context
  };
}

export const logger: Logger = {
  debug(msg: string, context?: LogContext) {
    emit("debug", msg, context);
  },

  info(msg: string, context?: LogContext) {
    emit("info", msg, context);
  },

  warn(msg: string, context?: LogContext) {
    emit("warn", msg, context);
  },

  error(msg: string, context?: LogContext) {
    emit("error", msg, context);
  },

  child(defaults: LogContext) {
    return childLogger(defaults);
  }
};

export function requestLogger(request: Request, context: LogContext = {}) {
  return logger.child(getRequestContext(request, context));
}
