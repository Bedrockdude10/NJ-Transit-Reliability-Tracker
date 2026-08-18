/**
 * JSON-lines logger, reached through `@njt/shared/logger` rather than the
 * package index so it stays out of the app bundle.
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

/** Discards all output. */
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
