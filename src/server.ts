import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { BechError, type ErrorCode } from './errors.js';
import { decodeRequest, encodeRequest, explainRequest, roundTripHex } from './service.js';
import { ExampleStore } from './store.js';

type Json = Record<string, unknown>;

export type ServerOptions = {
  port?: number;
  dataDir?: string;
};

export function createApp(options: ServerOptions = {}): { server: Server; store: ExampleStore } {
  const databasePath = resolve(options.dataDir ?? 'data', 'bech32-examples.sqlite');
  const store = new ExampleStore(databasePath);

  const server = createServer(async (request, response) => {
    try {
      await route(request, response, store);
    } catch (error) {
      sendError(response, error);
    }
  });

  return { server, store };
}

export async function startServer(options: ServerOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const { server, store } = createApp(options);
  const port = options.port ?? (await findFreePort());
  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法确定监听端口');
  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
    },
  };
}

async function route(request: IncomingMessage, response: ServerResponse, store: ExampleStore): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'GET' && path === '/health') {
    sendJson(response, { ok: true, service: 'bech32-backend' });
    return;
  }

  if (method === 'POST' && path === '/api/encode') {
    const body = await readJson(request);
    sendJson(response, encodeRequest(toEncodeRequest(body)));
    return;
  }

  if (method === 'POST' && path === '/api/decode') {
    const body = await readJson(request);
    sendJson(response, decodeRequest(toDecodeRequest(body)));
    return;
  }

  if (method === 'POST' && path === '/api/explain') {
    const body = await readJson(request);
    sendJson(response, explainRequest(requiredString(body, 'hrp'), normalizeData(body.data), variant(body.variant)));
    return;
  }

  if (method === 'POST' && path === '/api/roundtrip') {
    const body = await readJson(request);
    sendJson(response, roundTripHex(requiredString(body, 'hex'), variant(body.variant), optionalString(body.hrp, 'hrp') ?? 'tb'));
    return;
  }

  if (method === 'POST' && path === '/api/examples') {
    const body = await readJson(request);
    const result = store.save({
      name: String(body.name),
      kind: String(body.kind ?? 'manual'),
      originalInput: body.originalInput ?? body,
      normalizedString: optionalString(body.normalizedString, 'normalizedString'),
      variant: body.variant === null || body.variant === undefined ? null : String(body.variant),
      data: Array.isArray(body.data) ? body.data : null,
      diagnostics: body.diagnostics ?? body,
    });
    sendJson(response, result, 201);
    return;
  }

  if (method === 'GET' && path === '/api/examples') {
    sendJson(response, { examples: store.history(url.searchParams.get('name') ?? undefined) });
    return;
  }

  if (method === 'GET' && /^\/api\/examples\/[^/]+$/.test(path)) {
    const name = decodeURIComponent(path.split('/').pop() ?? '');
    const example = store.latest(name);
    if (!example) throw new BechError('NOT_FOUND', '算例不存在');
    sendJson(response, example);
    return;
  }

  if (method === 'GET' && path === '/api/export') {
    sendJson(response, { exportedAt: new Date().toISOString(), examples: store.exportJson() });
    return;
  }

  sendJson(response, { error: { code: 'NOT_FOUND', message: '路径不存在' } }, 404);
}

function toEncodeRequest(body: Json) {
  return {
    hrp: requiredString(body, 'hrp'),
    variant: body.variant === undefined ? undefined : variant(body.variant),
    data: body.data === undefined ? undefined : normalizeData(body.data),
    hex: body.hex === undefined ? undefined : requiredString(body, 'hex'),
  };
}

function toDecodeRequest(body: Json) {
  return {
    input: requiredString(body, 'input'),
    expectedHrp: body.expectedHrp === undefined ? undefined : requiredString(body, 'expectedHrp'),
    mode: body.mode === undefined ? undefined : mode(body.mode),
    expectedVariant: body.expectedVariant === undefined ? undefined : variant(body.expectedVariant),
  };
}

function requiredString(body: Json, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) throw new BechError('MISSING_INPUT', `${key} 必须是非空字符串`);
  return value;
}

function optionalString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BechError('MISSING_INPUT', `${name} 必须是字符串`);
  return value;
}

function variant(value: unknown): 'bech32' | 'bech32m' {
  if (value !== 'bech32' && value !== 'bech32m') throw new BechError('UNKNOWN_VARIANT', 'variant 必须是 bech32 或 bech32m');
  return value;
}

function mode(value: unknown): 'words' | 'bytes' {
  if (value !== 'words' && value !== 'bytes') throw new BechError('INVALID_CHARACTER', 'mode 必须是 words 或 bytes');
  return value;
}

function normalizeData(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BechError('INVALID_FIVE_BIT_VALUE', 'data 必须是数组');
  return value.map((item) => Number(item));
}

async function readJson(request: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
    return parsed as Json;
  } catch {
    throw new BechError('INVALID_CHARACTER', '请求体必须是 JSON 对象');
  }
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value, (_key, nested) => (typeof nested === 'bigint' ? Number(nested) : nested));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof BechError) {
    sendJson(response, { error: { code: error.code, message: error.message, details: error.details ?? null } }, error.code === 'NOT_FOUND' ? 404 : 400);
    return;
  }
  const message = error instanceof Error ? error.message : '未知错误';
  sendJson(response, { error: { code: 'INTERNAL_ERROR' as ErrorCode, message } }, 500);
}

async function findFreePort(): Promise<number> {
  const temporary = createServer();
  await new Promise<void>((done) => temporary.listen(0, '127.0.0.1', () => done()));
  const address = temporary.address();
  if (!address || typeof address === 'string') throw new Error('无法获取空闲端口');
  const port = address.port;
  await new Promise<void>((done) => temporary.close(() => done()));
  return port;
}
