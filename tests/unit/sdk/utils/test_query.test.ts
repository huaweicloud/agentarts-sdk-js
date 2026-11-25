/**
 * Unit tests for the shared query serialization helpers.
 *
 * The wire URL and the AK/SK canonical query must agree byte for byte, so
 * these cases pin both the encoding and the normalization rules.
 */

import { describe, it, expect } from 'vitest';

import {
  appendQueryParams,
  encodeRfc3986,
  normalizeQueryParams,
} from 'agentarts-sdk/sdk/utils/query';

describe('TestEncodeRfc3986', () => {
  it('encodes spaces as %20 and keeps ~ unescaped', () => {
    expect(encodeRfc3986('agent one~x')).toBe('agent%20one~x');
  });

  it('escapes the characters encodeURIComponent leaves alone', () => {
    expect(encodeRfc3986("!( )'*")).toBe('%21%28%20%29%27%2A');
  });

  it('does not produce the form-style plus sign', () => {
    expect(encodeRfc3986('a b')).not.toContain('+');
    expect(encodeRfc3986('a+b')).toBe('a%2Bb');
  });

  it('encodes non-ASCII text as UTF-8 bytes', () => {
    expect(encodeRfc3986('测试')).toBe('%E6%B5%8B%E8%AF%95');
  });
});

describe('TestNormalizeQueryParams', () => {
  it('drops null and undefined values', () => {
    expect(
      normalizeQueryParams({ keep: 'v', empty: null, missing: undefined }),
    ).toEqual({ keep: 'v' });
  });

  it('stringifies scalars once', () => {
    expect(normalizeQueryParams({ limit: 10, flag: false })).toEqual({
      limit: '10',
      flag: 'false',
    });
  });

  it('sorts array values without mutating the caller array', () => {
    const original = ['prod', 'dev'];
    const normalized = normalizeQueryParams({ tag: original });

    expect(normalized.tag).toEqual(['dev', 'prod']);
    expect(original).toEqual(['prod', 'dev']);
  });

  it('drops empty arrays instead of emitting an empty parameter', () => {
    expect(normalizeQueryParams({ tag: [] })).toEqual({});
    expect(normalizeQueryParams({ tag: [null, undefined] })).toEqual({});
  });
});

describe('TestAppendQueryParams', () => {
  it('returns the URL unchanged when nothing survives normalization', () => {
    expect(appendQueryParams('https://example.com/a', { x: null })).toBe(
      'https://example.com/a',
    );
    expect(appendQueryParams('https://example.com/a')).toBe('https://example.com/a');
  });

  it('appends with ? when the URL has no query', () => {
    expect(appendQueryParams('https://example.com/a', { a: 1 })).toBe(
      'https://example.com/a?a=1',
    );
  });

  it('appends with & and keeps a single ? when a query already exists', () => {
    const url = appendQueryParams('https://example.com/a?foo=1', { bar: '2' });
    expect(url).toBe('https://example.com/a?foo=1&bar=2');
    expect(url.split('?').length - 1).toBe(1);
  });

  it('repeats the key for array values in sorted order', () => {
    expect(appendQueryParams('https://example.com/a', { tag: ['prod', 'dev'] })).toBe(
      'https://example.com/a?tag=dev&tag=prod',
    );
  });

  it('matches the canonical encoding for spaces, brackets and tilde', () => {
    const url = appendQueryParams('https://example.com/a', { name: 'agent one(x)~' });
    expect(url).toContain('name=agent%20one%28x%29~');
    expect(url).not.toContain('+');
  });
});