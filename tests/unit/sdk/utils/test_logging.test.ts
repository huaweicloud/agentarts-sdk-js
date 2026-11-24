/**
 * Tests for SDK logging configuration utilities.
 *
 * Ported 1:1 from `tests/unit/sdk/utils/test_logging.py`.
 *
 * Python configures `logging` handlers/formatters directly (StreamHandler,
 * FileHandler, `caplog`). The Node.js port writes to `console` through a
 * lightweight logger factory, so the equivalent assertions observe `console`
 * output instead of handler objects. See PORTING.md §10.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  DEFAULT_LOG_LEVEL,
  ENV_LOG_LEVEL,
  getLogLevel,
  getLogger,
  setupLogging,
} from 'agentarts-sdk/sdk/utils/logging';

const ENV_SNAPSHOT = process.env[ENV_LOG_LEVEL];

/** Reset `AGENTARTS_LOG_LEVEL` to the value the test file started with. */
function restoreEnv(): void {
  if (ENV_SNAPSHOT === undefined) {
    delete process.env[ENV_LOG_LEVEL];
  } else {
    process.env[ENV_LOG_LEVEL] = ENV_SNAPSHOT;
  }
}

/** Capture everything the SDK logger writes through `console`. */
function captureConsole(): { lines: string[] } {
  const lines: string[] = [];
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '));
    });
  }
  return { lines };
}

beforeEach(() => {
  restoreEnv();
  setupLogging(null);
});

afterEach(() => {
  restoreEnv();
  setupLogging(null);
  vi.unstubAllGlobals();
});

describe('TestGetLogLevel', () => {
  it('returns default when env not set', () => {
    delete process.env[ENV_LOG_LEVEL];
    expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
  });

  it('returns env value when set', () => {
    process.env[ENV_LOG_LEVEL] = 'DEBUG';
    expect(getLogLevel()).toBe('DEBUG');
  });

  it('returns env value uppercase', () => {
    process.env[ENV_LOG_LEVEL] = 'debug';
    expect(getLogLevel()).toBe('DEBUG');
  });

  it('returns default for invalid level', () => {
    process.env[ENV_LOG_LEVEL] = 'INVALID';
    expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
  });

  it('supports all valid levels', () => {
    const validLevels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
    for (const level of validLevels) {
      process.env[ENV_LOG_LEVEL] = level;
      expect(getLogLevel()).toBe(level);
    }
  });
});

describe('TestSetupLogging', () => {
  it('sets sdk logger level', () => {
    setupLogging('DEBUG');
    expect(getLogger('test').getLevel()).toBe('DEBUG');
  });

  it('adds stream handler by default', () => {
    // Python installs a StreamHandler when none is provided; the Node.js port
    // writes to the console by default (no handler registration required).
    const { lines } = captureConsole();
    setupLogging('INFO');

    getLogger('test').info('Info message');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Info message');
  });

  it('does not add duplicate handlers', () => {
    // Calling setupLogging() repeatedly must not duplicate output lines.
    const { lines } = captureConsole();
    setupLogging('INFO');
    setupLogging('DEBUG');

    getLogger('test').info('Info message');

    expect(lines).toHaveLength(1);
  });

  it('uses format argument without breaking the console sink', () => {
    // Python supports a custom handler; the Node.js signature keeps a
    // `_format` placeholder for parity and always prints `[name] message`.
    const { lines } = captureConsole();
    setupLogging('INFO', '%(asctime)s %(levelname)s %(message)s');

    getLogger('test').info('Info message');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Info message');
  });

  it('uses env level when none provided', () => {
    process.env[ENV_LOG_LEVEL] = 'WARNING';
    setupLogging();
    expect(getLogger('test').getLevel()).toBe('WARNING');
  });
});

describe('TestGetLogger', () => {
  it('returns logger with sdk namespace', () => {
    const { lines } = captureConsole();
    setupLogging('INFO');

    getLogger('test').info('message');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[agentarts.test]');
  });

  it('returns logger with nested namespace', () => {
    const { lines } = captureConsole();
    setupLogging('INFO');

    getLogger('runtime.app').info('message');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[agentarts.runtime.app]');
  });

  it('returns same logger for same name', () => {
    const logger1 = getLogger('test');
    const logger2 = getLogger('test');
    expect(logger1).toBe(logger2);
  });
});

describe('TestLoggingIntegration', () => {
  it('logger inherits sdk level', () => {
    delete process.env[ENV_LOG_LEVEL];
    setupLogging('DEBUG');

    expect(getLogger('runtime.app').getLevel()).toBe('DEBUG');
  });

  it('debug messages visible at debug level', () => {
    const { lines } = captureConsole();
    setupLogging('DEBUG');

    getLogger('test').debug('Debug message');

    expect(lines.join('\n')).toContain('Debug message');
  });

  it('debug messages hidden at info level', () => {
    const { lines } = captureConsole();
    setupLogging('INFO');

    getLogger('test').debug('Debug message');

    expect(lines.join('\n')).not.toContain('Debug message');
    expect(lines).toHaveLength(0);
  });

  it('info messages visible at info level', () => {
    const { lines } = captureConsole();
    setupLogging('INFO');

    getLogger('test').info('Info message');

    expect(lines.join('\n')).toContain('Info message');
  });
});

describe('SDK diagnostics use stderr', () => {
  it('keeps INFO and DEBUG messages off stdout', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setupLogging('DEBUG');
    getLogger('stream-check').info('info message');
    getLogger('stream-check').debug('debug message');
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(2);
  });
});
