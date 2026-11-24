/**
 * AgentArts SDK logging configuration utilities.
 *
 * Mirrors `agentarts/sdk/utils/logging.py`: a lightweight logger factory
 * with levels controlled by the `AGENTARTS_LOG_LEVEL` environment variable.
 * Diagnostics use stderr so stdout can carry application data / CLI JSON.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export const ENV_LOG_LEVEL = 'AGENTARTS_LOG_LEVEL';

export const DEFAULT_LOG_LEVEL: LogLevel = 'INFO';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

export function getLogLevel(): LogLevel {
  const level = (process.env[ENV_LOG_LEVEL] ?? DEFAULT_LOG_LEVEL).toUpperCase();
  if (level in LEVEL_WEIGHT) {
    return level as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

let currentLevel: LogLevel | undefined;

function isEnabled(level: LogLevel): boolean {
  const active = currentLevel ?? getLogLevel();
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[active];
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warning(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  exception(...args: unknown[]): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

function formatMessage(prefix: string, args: unknown[]): string {
  const body = args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack ?? `${arg.name}: ${arg.message}`;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  return prefix ? `${prefix} ${body}` : body;
}

class ConsoleLogger implements Logger {
  constructor(private readonly name: string) {}

  debug(...args: unknown[]): void {
    if (isEnabled('DEBUG')) console.error(formatMessage(`[${this.name}]`, args));
  }

  info(...args: unknown[]): void {
    if (isEnabled('INFO')) console.error(formatMessage(`[${this.name}]`, args));
  }

  warning(...args: unknown[]): void {
    if (isEnabled('WARNING')) console.warn(formatMessage(`[${this.name}]`, args));
  }

  warn(...args: unknown[]): void {
    this.warning(...args);
  }

  error(...args: unknown[]): void {
    if (isEnabled('ERROR')) console.error(formatMessage(`[${this.name}]`, args));
  }

  exception(...args: unknown[]): void {
    if (isEnabled('ERROR')) console.error(formatMessage(`[${this.name}]`, args));
  }

  setLevel(level: LogLevel): void {
    currentLevel = level;
  }

  getLevel(): LogLevel {
    return currentLevel ?? getLogLevel();
  }
}

const loggers = new Map<string, Logger>();

/**
 * Configure SDK logging.
 *
 * @param level Log level. If omitted, `AGENTARTS_LOG_LEVEL` (or INFO) is used.
 * @param _format Kept for parity with the Python signature; the Node.js logger
 *   always prints `[name] message`.
 */
export function setupLogging(level?: LogLevel | null, _format?: string | null): void {
  currentLevel = level ?? getLogLevel();
}

/** Get a logger with the SDK namespace (`agentarts.<name>`). */
export function getLogger(name: string): Logger {
  const fullName = name.startsWith('agentarts.') ? name : `agentarts.${name}`;
  let logger = loggers.get(fullName);
  if (!logger) {
    logger = new ConsoleLogger(fullName);
    loggers.set(fullName, logger);
  }
  return logger;
}
