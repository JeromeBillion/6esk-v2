/**
 * Structured logger for 6esk v2 production environment.
 *
 * Wraps console.* with structured JSON context so that log aggregators
 * (Railway, Datadog, CloudWatch, etc.) can parse fields automatically.
 *
 * Usage:
 *   import { logger } from "@/server/logger";
 *   logger.info("Ticket created", { ticketId, tenantId });
 *   logger.error("Failed to send reply", { ticketId, error: err.message });
 *   logger.warn("Slow query", { durationMs: 1200, query: "listTickets" });
 *
 * All log lines are JSON-serialized for machine parsing:
 *   {"level":"info","msg":"Ticket created","ticketId":"abc","tenantId":"t1","ts":"2026-05-10T03:00:00.000Z"}
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveMinLevel(): LogLevel {
  const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
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

function emit(level: LogLevel, msg: string, context?: LogContext) {
  if (!shouldLog(level)) return;

  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...context,
  };

  // Normalize error fields
  if (entry.error !== undefined) {
    entry.error = formatError(entry.error);
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

export const logger = {
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

  /**
   * Create a child logger that includes default context fields.
   * Useful for request-scoped or tenant-scoped logging.
   *
   *   const log = logger.child({ tenantId, requestId });
   *   log.info("Processing ticket");
   *   // → {"level":"info","msg":"Processing ticket","tenantId":"t1","requestId":"r1","ts":"..."}
   */
  child(defaults: LogContext) {
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
    };
  },
};
