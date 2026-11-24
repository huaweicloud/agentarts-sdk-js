/**
 * Unit tests for the Gateway CLI commands.
 *
 * Ported 1:1 from `tests/unit/toolkit/cli/gateway/test_gateway_cli.py`.
 *
 * Mock strategy:
 * - `typer.testing.CliRunner` → `createGatewayCommand()` +
 *   `program.parseAsync(args, { from: "user" })` (never exits the process);
 * - `patch.object(gateway_module, "_get_gateway_client")` → `vi.mock` of the
 *   gateway SDK module with `GatewayClient` replaced by a `vi.fn()` returning a
 *   mock client (the CLI helper itself is module-private);
 * - `runner.invoke(..., input="y"/"n")` → `vi.mock("node:readline/promises")`
 *   whose `question()` resolves the canned answer (the delete confirmation);
 * - `result.output` → the toolkit console `print`/`printPanel` spies.
 *
 * Behaviour differences: `_handle_error` and `_get_gateway_client` are not
 * exported by the TypeScript module, so they are exercised through the commands
 * (`get` for the error branches, `create`/`create -k` for the client factory).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createGatewayCommand,
  formatOutput,
  parseJson,
} from 'agentarts-sdk/toolkit/cli/gateway/gateway';
import { console as toolkitConsole } from 'agentarts-sdk/toolkit/utils/console';
import { RequestResult } from 'agentarts-sdk/sdk/service/http-client';

/** Canned answer returned by the mocked readline question. */
const readlineMocks = vi.hoisted(() => ({ answer: 'n' }));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: () => Promise.resolve(readlineMocks.answer),
    close: () => undefined,
  }),
}));

/** Mock gateway client returned by the mocked `GatewayClient` constructor. */
const gatewayMocks = vi.hoisted(() => ({
  instance: {} as Record<string, any>,
  GatewayClient: null as any,
}));

vi.mock('agentarts-sdk/sdk/gateway/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('agentarts-sdk/sdk/gateway/index')>();
  gatewayMocks.GatewayClient = vi.fn(function () {
    return gatewayMocks.instance;
  });
  return {
    ...actual,
    GatewayClient: gatewayMocks.GatewayClient as unknown as typeof actual.GatewayClient,
  };
});

/** Successful request result carrying `data`. */
function okResult(data: Record<string, any> | null = null): RequestResult {
  return new RequestResult({ success: true, statusCode: 200, data });
}

/** Failed request result (Python `Mock(success=False, data=..., error=...)`). */
function errorResult(data: Record<string, any> | null, error: string | null = null): RequestResult {
  return new RequestResult({ success: false, statusCode: 400, data, error });
}

let output: string[];

beforeEach(() => {
  output = [];
  vi.spyOn(toolkitConsole, 'print').mockImplementation((message = '') => {
    output.push(String(message));
  });
  vi.spyOn(toolkitConsole, 'printPanel').mockImplementation(() => undefined);

  gatewayMocks.instance = {
    close: vi.fn(),
    createGateway: vi.fn().mockResolvedValue(okResult({ gateway_id: 'test-id' })),
    updateGateway: vi.fn().mockResolvedValue(okResult({ gateway_id: 'test-id' })),
    deleteGateway: vi.fn().mockResolvedValue(okResult()),
    getGateway: vi.fn().mockResolvedValue(okResult({ gateway_id: 'test-id' })),
    listGateways: vi.fn().mockResolvedValue(okResult({ total: 0, gateways: [] })),
    createGatewayTarget: vi.fn().mockResolvedValue(okResult({ target_id: 'test-target-id' })),
    updateGatewayTarget: vi.fn().mockResolvedValue(okResult({ target_id: 'test-target-id' })),
    deleteGatewayTarget: vi.fn().mockResolvedValue(okResult()),
    getGatewayTarget: vi.fn().mockResolvedValue(okResult({ target_id: 'test-target-id' })),
    listGatewayTargets: vi.fn().mockResolvedValue(okResult({ total: 0, targets: [] })),
  };
  readlineMocks.answer = 'n';
});

/** Run `agentarts gateway <args>` and return the captured output. */
async function runGateway(args: string[]): Promise<string> {
  const gateway = createGatewayCommand();
  process.exitCode = 0;
  await gateway.parseAsync(args, { from: 'user' });
  return output.join('\n');
}

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('raises for invalid JSON', () => {
    expect(() => parseJson('{"key": "value"')).toThrow('Invalid JSON format');
  });

  it('returns null for an empty string', () => {
    expect(parseJson('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseJson(null)).toBeNull();
  });
});

describe('formatOutput', () => {
  it('formats JSON-serializable data', () => {
    const result = formatOutput({ key: 'value' });

    expect(typeof result).toBe('string');
    expect(result).toContain('key');
    expect(result).toContain('value');
  });

  it('falls back to the string form of non-serializable data', () => {
    // Python's `json.dumps` raises for such objects; the port's
    // `JSON.stringify` raises for a circular structure and then uses `String()`.
    class NonSerializable {
      self?: NonSerializable;

      toString(): string {
        return 'NonSerializable object';
      }
    }
    const data = new NonSerializable();
    data.self = data;

    const result = formatOutput(data);

    expect(typeof result).toBe('string');
    expect(result).toContain('NonSerializable object');
  });
});

describe('create', () => {
  it('creates a gateway', async () => {
    const result = await runGateway(['create', '--name', 'test-gateway']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['createGateway']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Gateway created successfully');
  });

  it('passes the JSON configuration', async () => {
    const result = await runGateway([
      'create',
      '--name',
      'test-gateway',
      '--protocol-configuration',
      '{"mcp": {"search_configuration": {}}}',
    ]);

    expect(process.exitCode ?? 0).toBe(0);
    const options = gatewayMocks.instance['createGateway'].mock.calls[0]![0];
    expect(options['protocolConfiguration']).toEqual({ mcp: { search_configuration: {} } });
    expect(result).toContain('Gateway created successfully');
  });

  it('reports invalid JSON', async () => {
    const result = await runGateway([
      'create',
      '--name',
      'test-gateway',
      '--protocol-configuration',
      '{"invalid json',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Invalid JSON format');
  });

  it('reports an error response', async () => {
    gatewayMocks.instance['createGateway'].mockResolvedValue(
      errorResult({ error_code: '400', error_msg: 'Bad request' }),
    );

    const result = await runGateway(['create', '--name', 'test-gateway']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Error creating gateway');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['createGateway'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['create', '--name', 'test-gateway']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });

  it('builds the client with SSL verification enabled', async () => {
    await runGateway(['create', '--name', 'test-gateway']);

    expect(gatewayMocks.GatewayClient).toHaveBeenCalledWith(true);
  });

  it('builds the client with SSL verification skipped', async () => {
    await runGateway(['create', '--name', 'test-gateway', '--skip-ssl-verification']);

    expect(gatewayMocks.GatewayClient).toHaveBeenCalledWith(false);
  });
});

describe('update', () => {
  it('updates a gateway', async () => {
    const result = await runGateway(['update', 'test-id', '--description', 'Updated']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['updateGateway']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Gateway updated successfully');
  });

  it('reports invalid JSON', async () => {
    const result = await runGateway([
      'update',
      'test-id',
      '--protocol-configuration',
      '{"invalid json',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Invalid JSON format');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['updateGateway'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['update', 'test-id', '--description', 'Updated']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('delete', () => {
  it('cancels the deletion', async () => {
    readlineMocks.answer = 'n';

    const result = await runGateway(['delete', 'test-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(result).toContain('Deletion cancelled');
    expect(gatewayMocks.instance['deleteGateway']).not.toHaveBeenCalled();
  });

  it('deletes the gateway when confirmed', async () => {
    readlineMocks.answer = 'y';

    const result = await runGateway(['delete', 'test-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['deleteGateway']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Gateway deleted successfully');
  });

  it('reports an unexpected error', async () => {
    readlineMocks.answer = 'y';
    gatewayMocks.instance['deleteGateway'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['delete', 'test-id']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('get', () => {
  it('gets a gateway', async () => {
    const result = await runGateway(['get', 'test-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['getGateway']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Gateway details');
  });

  it('reports an error response with error fields', async () => {
    gatewayMocks.instance['getGateway'].mockResolvedValue(
      errorResult({ error_code: '400', error_msg: 'Bad request' }),
    );

    const result = await runGateway(['get', 'test-id']);

    expect(result).toContain('Error getting gateway');
    expect(result).toContain('400');
    expect(result).toContain('Bad request');
  });

  it('reports an error response without error fields', async () => {
    gatewayMocks.instance['getGateway'].mockResolvedValue(
      errorResult({ message: 'Unknown error' }, 'Connection failed'),
    );

    const result = await runGateway(['get', 'test-id']);

    expect(result).toContain('Error getting gateway');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['getGateway'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['get', 'test-id']);

    expect(result).toContain('Unexpected error');
  });
});

describe('list', () => {
  it('lists the gateways', async () => {
    const result = await runGateway(['list']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['listGateways']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Total gateways');
  });

  it('passes the filters', async () => {
    gatewayMocks.instance['listGateways'].mockResolvedValue(
      okResult({ total: 1, gateways: [{ name: 'test' }] }),
    );

    await runGateway([
      'list',
      '--name',
      'test',
      '--limit',
      '10',
      '--offset',
      '0',
      '--tag-key-exists',
      'key1,key2',
    ]);

    const options = gatewayMocks.instance['listGateways'].mock.calls[0]![0];
    expect(options['name']).toBe('test');
    expect(options['limit']).toBe(10);
    expect(options['offset']).toBe(0);
    expect(options['tagKeyExists']).toEqual(['key1', 'key2']);
  });

  it('rejects a negative offset', async () => {
    const result = await runGateway(['list', '--offset', '-1']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Offset must be greater than or equal to 0');
  });

  it('rejects a limit of zero', async () => {
    const result = await runGateway(['list', '--limit', '0']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Limit must be greater than 0');
  });

  it('rejects an offset above the maximum', async () => {
    const result = await runGateway(['list', '--offset', '100001']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Offset must be less than or equal to 100000');
  });

  it('rejects a limit above the maximum', async () => {
    const result = await runGateway(['list', '--limit', '101']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Limit must be less than or equal to 100');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['listGateways'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['list']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('create-target', () => {
  it('creates a gateway target', async () => {
    const result = await runGateway([
      'create-target',
      'test-gateway-id',
      '--target-configuration',
      '{"type": "http"}',
    ]);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['createGatewayTarget']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Target created successfully');
  });

  it('reports invalid JSON', async () => {
    const result = await runGateway([
      'create-target',
      'test-gateway-id',
      '--target-configuration',
      '{"invalid json',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Invalid JSON format');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['createGatewayTarget'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway([
      'create-target',
      'test-gateway-id',
      '--target-configuration',
      '{"type": "http"}',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('update-target', () => {
  it('updates a gateway target', async () => {
    const result = await runGateway([
      'update-target',
      'test-gateway-id',
      'test-target-id',
      '--name',
      'updated-target',
    ]);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['updateGatewayTarget']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Target updated successfully');
  });

  it('reports invalid JSON', async () => {
    const result = await runGateway([
      'update-target',
      'test-gateway-id',
      'test-target-id',
      '--target-configuration',
      '{"invalid json',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Invalid JSON format');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['updateGatewayTarget'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway([
      'update-target',
      'test-gateway-id',
      'test-target-id',
      '--name',
      'updated-target',
    ]);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('delete-target', () => {
  it('cancels the deletion', async () => {
    readlineMocks.answer = 'n';

    const result = await runGateway(['delete-target', 'test-gateway-id', 'test-target-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(result).toContain('Deletion cancelled');
    expect(gatewayMocks.instance['deleteGatewayTarget']).not.toHaveBeenCalled();
  });

  it('deletes the target when confirmed', async () => {
    readlineMocks.answer = 'y';

    const result = await runGateway(['delete-target', 'test-gateway-id', 'test-target-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['deleteGatewayTarget']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Target deleted successfully');
  });

  it('reports an unexpected error', async () => {
    readlineMocks.answer = 'y';
    gatewayMocks.instance['deleteGatewayTarget'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['delete-target', 'test-gateway-id', 'test-target-id']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('get-target', () => {
  it('gets a gateway target', async () => {
    const result = await runGateway(['get-target', 'test-gateway-id', 'test-target-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['getGatewayTarget']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Target details');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['getGatewayTarget'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['get-target', 'test-gateway-id', 'test-target-id']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('list-targets', () => {
  it('lists the gateway targets', async () => {
    const result = await runGateway(['list-targets', 'test-gateway-id']);

    expect(process.exitCode ?? 0).toBe(0);
    expect(gatewayMocks.instance['listGatewayTargets']).toHaveBeenCalledTimes(1);
    expect(result).toContain('Total targets');
  });

  it('rejects an offset above the maximum', async () => {
    const result = await runGateway(['list-targets', 'test-gateway-id', '--offset', '100001']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Offset must be less than or equal to 100000');
  });

  it('rejects a limit above the maximum', async () => {
    const result = await runGateway(['list-targets', 'test-gateway-id', '--limit', '101']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Limit must be less than or equal to 100');
  });

  it('reports an unexpected error', async () => {
    gatewayMocks.instance['listGatewayTargets'].mockRejectedValue(new Error('Unexpected error'));

    const result = await runGateway(['list-targets', 'test-gateway-id']);

    expect(process.exitCode ?? 0).toBe(1);
    expect(result).toContain('Unexpected error');
  });
});

describe('Gateway validation regression', () => {
  it.each(['NaN', 'Infinity', '1.5', '9007199254740992'])(
    'rejects invalid numeric pagination %s before SDK calls',
    async (limit) => {
      await runGateway(['list', '--limit', limit]);
      expect(process.exitCode).toBe(1);
      expect(gatewayMocks.instance['listGateways']).not.toHaveBeenCalled();
      process.exitCode = 0;
    },
  );
  it.each(['[]', 'null', 'true', '"text"'])(
    'rejects a non-object configuration %s',
    async (configuration) => {
      await runGateway(['create', '--protocol-configuration', configuration]);
      expect(process.exitCode).toBe(1);
      expect(gatewayMocks.instance['createGateway']).not.toHaveBeenCalled();
      process.exitCode = 0;
    },
  );
});
