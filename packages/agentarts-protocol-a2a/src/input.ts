import { ProtocolHttpError } from '@huaweicloud/agentarts-sdk/sdk/runtime';

/** ProtoJSON accepts camelCase and original snake_case. Validate both before codec coercion. */
export function fields(
  value: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  const normalized = { ...value };
  for (const name of names) {
    const alias = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (alias === name || !Object.hasOwn(value, alias)) continue;
    if (Object.hasOwn(value, name))
      throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Duplicate parameter spellings');
    normalized[name] = value[alias];
    delete normalized[alias];
  }
  return normalized;
}
