/**
 * Structured logger. JSON lines, so production output is greppable and a Fly
 * log drain can filter on fields rather than on substrings.
 *
 * Lives in `shared` because both the pipeline and the API need it and neither
 * may import the other, and is reached through `@njt/shared/logger` rather than
 * the package index so it stays out of the app bundle — the app has no use for
 * a server logger. Same reasoning as `@njt/shared/zoned`.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function emit(level: string, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const consoleLogger: Logger = {
  info: (m, meta) => emit("info", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  error: (m, meta) => emit("error", m, meta),
};

/** Discards all output — used in tests. */
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
