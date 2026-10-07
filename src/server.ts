import * as http from 'node:http';
import {
  encode, decode, encodeBytes, decodeBytes, hexToBytes, bytesToWords,
  hrpExpand, polymodSteps, Variant,
} from './bech32';
import { CaseStore } from './db';
import { Bech32Error } from './errors';

const store = new CaseStore(process.env.BECH32_DB);

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}

function fail(res: http.ServerResponse, err: unknown): void {
  if (err instanceof Bech32Error) {
    json(res, 400, { ok: false, errorCode: err.code, message: err.message });
  } else {
    json(res, 500, { ok: false, errorCode: 'E_INTERNAL', message: String(err) });
  }
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Bech32Error('E_INPUT', '请求体必须是合法 JSON');
  }
}

/** 输入互斥解析：hex 与 words 只能给一个。 */
function parseWords(body: any): number[] {
  const hasHex = typeof body.hex === 'string';
  const hasWords = Array.isArray(body.words);
  if (hasHex && hasWords) throw new Bech32Error('E_INPUT', 'hex 与 words 互斥，只能提供一个');
  if (hasHex) return bytesToWords(hexToBytes(body.hex));
  if (hasWords) return body.words;
  throw new Bech32Error('E_INPUT', '必须提供 hex 或 words 之一');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/encode') {
      const b = await readBody(req);
      const variant = (b.variant ?? 'bech32') as Variant;
      if (typeof b.hex === 'string' && Array.isArray(b.words)) {
        throw new Bech32Error('E_INPUT', 'hex 与 words 互斥，只能提供一个');
      }
      const result = typeof b.hex === 'string'
        ? encodeBytes(b.hrp, hexToBytes(b.hex), variant)
        : encode(b.hrp, parseWords(b), variant);
      json(res, 200, { ok: true, ...result });
    } else if (req.method === 'POST' && url.pathname === '/decode') {
      const b = await readBody(req);
      const result = b.byteMode ? decodeBytes(b.input, b.expectedHrp) : decode(b.input, b.expectedHrp);
      json(res, 200, { ok: true, ...result });
    } else if (req.method === 'POST' && url.pathname === '/verify') {
      const b = await readBody(req);
      const result = decode(b.input, b.expectedHrp);
      json(res, 200, { ok: true, valid: true, variant: result.variant, hrp: result.hrp });
    } else if (req.method === 'POST' && url.pathname === '/explain') {
      const b = await readBody(req);
      const dec = decode(b.input, b.expectedHrp);
      const expanded = hrpExpand(dec.hrp);
      const steps = polymodSteps(expanded.concat(dec.data, dec.checksum));
      json(res, 200, { ok: true, ...dec, hrpExpanded: expanded, polymodSteps: steps });
    } else if (req.method === 'POST' && url.pathname === '/roundtrip') {
      const b = await readBody(req);
      const variant = (b.variant ?? 'bech32') as Variant;
      const enc = encodeBytes(b.hrp, hexToBytes(b.hex), variant);
      const dec = decodeBytes(enc.bech, b.hrp);
      json(res, 200, { ok: true, encoded: enc, decoded: dec, match: dec.hex === enc.inputHex });
    } else if (req.method === 'POST' && url.pathname === '/cases') {
      const b = await readBody(req);
      const dec = b.byteMode ? decodeBytes(b.input, b.expectedHrp) : decode(b.input, b.expectedHrp);
      const saved = store.save({
        original: dec.original, normalized: dec.normalized, variant: dec.variant,
        hrp: dec.hrp, data: JSON.stringify(dec.data),
        bytesHex: 'hex' in dec ? (dec as any).hex : null,
        ok: 1, errorCode: null, diagnostics: JSON.stringify(dec.diagnostics),
      });
      json(res, 200, { ok: true, saved });
    } else if (req.method === 'GET' && url.pathname === '/cases') {
      json(res, 200, { ok: true, cases: store.list(Number(url.searchParams.get('limit') ?? 50)) });
    } else if (req.method === 'GET' && url.pathname.startsWith('/cases/')) {
      json(res, 200, { ok: true, case: store.get(Number(url.pathname.slice(7))) });
    } else if (req.method === 'GET' && url.pathname === '/export') {
      json(res, 200, { ok: true, cases: store.list(10000) });
    } else {
      json(res, 404, { ok: false, errorCode: 'E_NOT_FOUND', message: '未知路由' });
    }
  } catch (err) {
    // 解码失败也落库（保存错误码与诊断），再返回错误
    if (err instanceof Bech32Error && req.method === 'POST' && url.pathname === '/cases') {
      try {
        const b = await readBody(req).catch(() => ({}));
        store.save({
          original: String(b.input ?? ''), normalized: String(b.input ?? '').toLowerCase(),
          variant: 'unknown', hrp: '', data: '[]', bytesHex: null,
          ok: 0, errorCode: err.code, diagnostics: JSON.stringify([err.message]),
        });
      } catch { /* 忽略落库失败 */ }
    }
    fail(res, err);
  }
});

const portEnv = process.env.PORT ? Number(process.env.PORT) : 0; // 0 = 自动选空闲端口
server.listen(portEnv, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : portEnv;
  console.log(`Bech32 后端已启动: http://localhost:${port}`);
});
