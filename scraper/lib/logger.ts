type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.SCRAPER_LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
const prefix = process.env.SCRAPER_WORKER_ID ? `[${process.env.SCRAPER_WORKER_ID}]` : "";

function emit(level: Level, message: string, extra?: unknown) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 19);
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${prefix} ${message}`.trimEnd();
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(extra === undefined ? `${line}\n` : `${line} ${JSON.stringify(extra)}\n`);
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
