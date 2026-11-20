/**
 * Zero-dependency `.env` loader for the agent_tools example.
 *
 * Neither Node.js nor `tsx` reads `.env` files automatically, so this module
 * parses the sibling `.env` file and copies its keys into `process.env`.
 * It is imported for its side effect as the very first import of
 * `integrate-tools.ts`, which makes the variables visible both when running
 * `tsx integrate-tools.ts` directly and when `agentarts dev` imports the entry.
 *
 * Rules (see `.env.example` for the file format):
 * - Real process environment variables always win: nothing is overridden.
 * - Empty values are skipped, so `FOO=` keeps the code default / fallback.
 * - Missing `.env` is not an error (bare `git clone` still works).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the `.env` file next to this module. */
export const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '.env');

/** Valid shell-style variable name. */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Normalize a raw right-hand-side value.
 *
 * Supports single/double quotes (double quotes expand `\n` / `\r` / `\t`) and
 * strips trailing ` # comment` from unquoted values.
 */
function parseValue(raw: string): string {
  const value = raw.trim();

  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      const inner = value.slice(1, -1);
      return quote === '"'
        ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        : inner;
    }
  }

  const commentIndex = value.search(/\s#/);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

/**
 * Load a `.env` file into `process.env` without overriding existing values.
 *
 * @param filePath Path of the env file (defaults to the sibling `.env`).
 * @returns Names of the variables that were actually injected.
 */
export function loadEnvFile(filePath: string = ENV_FILE): string[] {
  const target = resolve(filePath);
  if (!existsSync(target)) {
    return [];
  }

  const loaded: string[] = [];

  for (const rawLine of readFileSync(target, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Allow `export FOO=bar` (copied from a shell profile).
    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = assignment.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = assignment.slice(0, separator).trim();
    if (!KEY_PATTERN.test(key)) {
      continue;
    }

    const value = parseValue(assignment.slice(separator + 1));
    if (!value) {
      continue;
    }

    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
    loaded.push(key);
  }

  return loaded;
}

const loadedKeys = loadEnvFile();
if (loadedKeys.length > 0) {
  console.log(`[load-env] loaded ${loadedKeys.length} variable(s) from ${ENV_FILE}`);
}