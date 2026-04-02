/**
 * Logging utility that writes all output to stderr.
 *
 * The MCP Stdio transport uses stdout for JSON-RPC messages.
 * Any non-protocol output on stdout corrupts the message stream.
 * All logging MUST go through this module to stay on stderr.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const formatted = formatMessage(level, message);
  const extra = args.length > 0 ? " " + args.map(String).join(" ") : "";
  process.stderr.write(formatted + extra + "\n");
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log("debug", msg, ...args),
  info: (msg: string, ...args: unknown[]) => log("info", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log("warn", msg, ...args),
  error: (msg: string, ...args: unknown[]) => log("error", msg, ...args),
};
