import * as schemas from '@ag-ui/core/schemas';
import type { RunAgentInput } from '@ag-ui/core';
import { ProtocolHttpError } from '@huaweicloud/agentarts-sdk/sdk/runtime';

type ObjectSchema = { shape: Record<string, unknown> };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const messages: Record<string, ObjectSchema> = {
  user: schemas.UserMessageSchema,
  assistant: schemas.AssistantMessageSchema,
  system: schemas.SystemMessageSchema,
  developer: schemas.DeveloperMessageSchema,
  tool: schemas.ToolMessageSchema,
  activity: schemas.ActivityMessageSchema,
  reasoning: schemas.ReasoningMessageSchema,
};
const parts: Record<string, ObjectSchema> = {
  text: schemas.TextPartSchema,
  image: schemas.ImagePartSchema,
  audio: schemas.AudioPartSchema,
  video: schemas.VideoPartSchema,
  document: schemas.DocumentPartSchema,
};
const sources: Record<string, ObjectSchema> = {
  data: schemas.DataSourceSchema,
  url: schemas.UrlSourceSchema,
  file: schemas.FileSourceSchema,
};

/** Protocol objects are closed; metadata, state, tool parameters and forwardedProps are open. */
export function textInput(raw: unknown, onWarning: (message: string) => void, rich = false): RunAgentInput {
  let warnings = 0;
  const warn = (message: string) => {
    if (warnings++ < 8) onWarning(message);
    else if (warnings === 9) onWarning('AG-UI additional input compatibility warnings suppressed');
  };
  const pick = (value: unknown, schema: ObjectSchema, path: string): unknown => {
    if (!object(value)) return value; // Known malformed values must reach validation unchanged.
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.shape, key)) result[key] = item;
      else
        warn(`AG-UI stripped an unknown property at ${path}.${JSON.stringify(key.slice(0, 64))}`);
    }
    return result;
  };
  const map = (
    value: unknown,
    transform: (item: unknown, path: string) => unknown,
    path: string,
  ) => (Array.isArray(value) ? value.map((item, i) => transform(item, `${path}[${i}]`)) : value);
  const content = (value: unknown, path: string): unknown => {
    if (!Array.isArray(value)) return value;
    return value.flatMap((item, i) => {
      const at = `${path}[${i}]`;
      if (!object(item) || typeof item.type !== 'string') return [item];
      if (!Object.hasOwn(parts, item.type)) {
        warn(`AG-UI dropped an unknown content part at ${at}`);
        return [];
      }
      const result = pick(item, parts[item.type]!, at) as Record<string, unknown>;
      if (item.type !== 'text' && object(result.source)) {
        const kind = result.source.type;
        if (typeof kind === 'string' && !Object.hasOwn(sources, kind)) {
          warn(`AG-UI dropped a content part with an unknown source at ${at}`);
          return [];
        }
        if (typeof kind === 'string')
          result.source = pick(result.source, sources[kind]!, `${at}.source`);
      }
      return [result];
    });
  };
  const clean = pick(raw, schemas.RunAgentInputSchema, 'input');
  if (object(clean)) {
    if (Array.isArray(clean.messages))
      clean.messages = clean.messages.flatMap((message, i) => {
        const path = `input.messages[${i}]`;
        if (!object(message) || typeof message.role !== 'string') return [message];
        if (!Object.hasOwn(messages, message.role)) {
          warn(`AG-UI dropped an unknown message variant at ${path}`);
          return [];
        }
        const result = pick(message, messages[message.role]!, path) as Record<string, unknown>;
        if (['user', 'tool'].includes(message.role))
          result.content = content(result.content, `${path}.content`);
        if (result.toolCalls !== undefined)
          result.toolCalls = map(
            result.toolCalls,
            (call, at) => {
              const cleaned = pick(call, schemas.ToolCallSchema, at);
              if (object(cleaned) && cleaned.function !== undefined)
                cleaned.function = pick(
                  cleaned.function,
                  schemas.FunctionCallSchema,
                  `${at}.function`,
                );
              return cleaned;
            },
            `${path}.toolCalls`,
          );
        return [result];
      });
    for (const [key, schema] of [
      ['tools', schemas.ToolSchema],
      ['context', schemas.ContextSchema],
      ['resume', schemas.ResumeEntrySchema],
    ] as const) {
      if (clean[key] !== undefined)
        clean[key] = map(clean[key], (item, path) => pick(item, schema, path), `input.${key}`);
    }
  }
  const parsed = schemas.RunAgentInputSchema.safeParse(clean);
  if (!parsed.success) throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid AG-UI input');
  const input = parsed.data;
  if (input.protocolVersion !== undefined) {
    const version = /^(\d+)\.(\d+)$/.exec(input.protocolVersion);
    if (version && (version[1]!.replace(/^0+/, '') || '0') !== '1')
      throw new ProtocolHttpError(400, 'UNSUPPORTED_VERSION', 'Unsupported AG-UI major version');
    if (input.protocolVersion !== '1.0')
      warn('AG-UI peer declares a newer or unrecognised version; serving 1.0');
  }
  if (
    !rich && (
    input.tools.length ||
    input.resume?.length ||
    (input.state != null && (!object(input.state) || Object.keys(input.state).length)) ||
    input.messages.length > 128 ||
    input.messages.some(
      (message) =>
        !['user', 'assistant'].includes(message.role) ||
        (message.role === 'assistant' && message.toolCalls?.length),
    )
  ))
    throw new ProtocolHttpError(
      400,
      'UNSUPPORTED_CAPABILITY',
      'Only user/assistant text conversations are supported',
    );
  if (rich) return input;
  // Do not access URLs or opaque provider handles. Validate known parts above before dropping media.
  input.messages = input.messages.map((message, index) => {
    let value = 'content' in message ? message.content : undefined;
    if (Array.isArray(value)) {
      value = value
        .map((part, i) => {
          if (part.type === 'text') return part.text;
          warn(`AG-UI skipped unusable media at input.messages[${index}].content[${i}]`);
          return '';
        })
        .join('');
    }
    const text = value ?? '';
    if (typeof text !== 'string' || text.length > 65536)
      throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Text content limit exceeded');
    return { ...message, content: text } as typeof message;
  });
  return input;
}
