import { request } from 'node:https';
import { request as requestHttp } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TaskPushNotificationConfig, StreamResponse } from '@a2a-js/sdk';
import { RequestMalformedError } from '@a2a-js/sdk/errors';
import { boundedInteger } from '@huaweicloud/agentarts-sdk/sdk/runtime';

export interface A2aPushOptions {
  allowedOrigins: readonly string[];
  /** Only for explicitly allowlisted local test receivers. Never enable in a public deployment. */
  allowLoopbackForTesting?: boolean;
  timeoutMs?: number;
  maxPending?: number;
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a! < 224 &&
      !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31) &&
      !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
      !(a === 100 && b! >= 64 && b! <= 127) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113) && address !== '168.63.129.16';
  }
  // Restrict IPv6 egress to global unicast. Reject mapped, link-local and local networks.
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return /^[23][0-9a-f]{0,3}:/i.test(canonical) && !/^(2001:(db8|0):|2002:)/i.test(canonical);
}
export class A2aPushDispatcher {
  private readonly allowed: Set<string>;
  private readonly pending = new Set<Promise<void>>();
  private resolving = 0;
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  constructor(private readonly options: A2aPushOptions) {
    boundedInteger(options.timeoutMs ?? 5000, 'timeoutMs', 60000);
    boundedInteger(options.maxPending ?? 64, 'maxPending', 1024);
    if (!options.allowedOrigins.length || options.allowedOrigins.length > 32) throw new TypeError('Push origins must be explicitly allowlisted');
    this.allowed = new Set(options.allowedOrigins.map(value => {
      const url = new URL(value);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*') || (url.protocol !== 'https:' && !(options.allowLoopbackForTesting && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new TypeError('Invalid push origin');
      return url.origin;
    }));
  }
  private async destination(config: TaskPushNotificationConfig) {
    let url: URL;
    try { url = new URL(config.url); } catch { throw new RequestMalformedError('Invalid push destination'); }
    if (!this.allowed.has(url.origin) || url.username || url.password || url.hash) throw new RequestMalformedError('Push destination is not allowlisted');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await this.resolve(hostname);
    if (!records.length || records.some(record => !publicAddress(record.address) && !(this.options.allowLoopbackForTesting && ['127.0.0.1', '::1'].includes(record.address)))) throw new RequestMalformedError('Push destination is not a public address');
    return { url, record: records[0]! };
  }
  private async resolve(hostname: string) {
    if (this.resolving >= (this.options.maxPending ?? 64)) throw new RequestMalformedError('DNS capacity');
    this.resolving++;
    const operation = lookup(hostname, { all: true, verbatim: true });
    void operation.then(() => { this.resolving--; }, () => { this.resolving--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RequestMalformedError('Push DNS timeout')), this.options.timeoutMs ?? 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async validate(config: TaskPushNotificationConfig) {
    if (config.authentication && !['bearer', 'basic'].includes(config.authentication.scheme.toLowerCase())) throw new RequestMalformedError('Unsupported push authentication scheme');
    if (JSON.stringify(TaskPushNotificationConfig.toJSON(config)).length > 16384) throw new RequestMalformedError('Push config too large');
    if (/[\r\n]/.test(config.authentication?.credentials ?? '') || /[\r\n]/.test(config.token ?? '')) throw new RequestMalformedError('Invalid push credentials');
    await this.destination(config);
  }
  /** Wait for a delivery slot. Task publishers await each bounded batch. */
  async send(config: TaskPushNotificationConfig, event: StreamResponse) {
    const operation = this.deliverWhenAvailable(config, event);
    this.pending.add(operation);
    try { await operation; } finally { this.pending.delete(operation); }
  }
  private async deliverWhenAvailable(config: TaskPushNotificationConfig, event: StreamResponse) {
    if (this.active >= (this.options.maxPending ?? 64)) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      const body = JSON.stringify(StreamResponse.toJSON(event));
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Push body limit');
      await this.deliver(config, body);
    } finally {
      const next = this.waiters.shift();
      if (next) next(); else this.active--;
    }
  }
  private async deliver(config: TaskPushNotificationConfig, body: string) {
    const { url, record } = await this.destination(config); // Resolve and pin on every delivery (DNS rebinding protection).
    const headers: Record<string, string | number> = { 'content-type': 'application/a2a+json', 'content-length': Buffer.byteLength(body) };
    if (config.authentication) headers.authorization = `${config.authentication.scheme} ${config.authentication.credentials}`;
    if (config.token) headers['x-a2a-notification-token'] = config.token;
    await new Promise<void>((resolve, reject) => {
      const send = url.protocol === 'https:' ? request : requestHttp;
      const req = send(url, { method: 'POST', headers, lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [record]);
        else callback(null, record.address, record.family);
      } }, response => {
        let bytes = 0;
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8192) response.destroy(new Error('Push response limit')); });
        response.on('error', reject);
        response.on('end', () => response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error('Push receiver rejected notification')));
      });
      const timeout = setTimeout(() => req.destroy(new Error('Push delivery timeout')), this.options.timeoutMs ?? 5000);
      req.on('error', reject); req.on('close', () => clearTimeout(timeout));
      req.end(body); // Redirects are deliberately never followed; no ambient cookies or credentials.
    });
  }
  async flush() { await Promise.allSettled([...this.pending]); }
}
