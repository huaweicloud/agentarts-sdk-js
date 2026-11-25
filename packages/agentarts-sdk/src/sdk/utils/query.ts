/**
 * Query parameter serialization shared by the SDK HTTP clients.
 *
 * The URL sent on the wire and the canonical query used by the AK/SK signers
 * must be derived from the same normalized params. Otherwise a parameter only
 * one side keeps (a `null`/`undefined` value) or a different encoding (`+` vs
 * `%20`, `~` vs `%7E`) makes the server recompute a different canonical request
 * and reject the signature with `verify ak sk signature failed`.
 */

/**
 * RFC 3986 percent-encoding used by the AK/SK canonical query.
 *
 * `encodeURIComponent` leaves `! ' ( ) *` unescaped, while the canonical query
 * escapes them (`%21`, `%27`, ...), and it must never emit the form-style `+`
 * for spaces.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Normalize params into the exact shape both the wire URL and the signer use.
 *
 * - `null`/`undefined` values are dropped instead of being encoded literally.
 * - Scalars are stringified once.
 * - Arrays are copied, filtered and sorted, so the wire order is deterministic
 *   and never depends on the signer sorting the caller's array in place.
 */
export function normalizeQueryParams(
  params?: Record<string, any> | null,
): Record<string, any> {
  const normalized: Record<string, any> = {};
  if (!params) {
    return normalized;
  }
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .filter((item) => item !== undefined && item !== null)
        .map((item) => String(item))
        .sort();
      if (items.length > 0) {
        normalized[key] = items;
      }
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

/**
 * Append query parameters to a URL.
 *
 * Uses RFC 3986 encoding and repeats the key for array values. An existing
 * query string keeps its values and is extended with `&`, so the result never
 * contains a second `?`.
 */
export function appendQueryParams(
  url: string,
  params?: Record<string, any> | null,
): string {
  const normalized = normalizeQueryParams(params);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(normalized)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      parts.push(`${encodeRfc3986(key)}=${encodeRfc3986(item)}`);
    }
  }
  if (parts.length === 0) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
}