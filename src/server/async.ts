import { logger } from "@/server/logger";

type BackgroundContext = Record<string, unknown>;

export function runInBackground<T>(
  promise: Promise<T>,
  message: string,
  context: BackgroundContext = {}
) {
  void promise.catch((error) => {
    logger.error(message, { error, ...context });
  });
}
