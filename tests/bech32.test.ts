import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CONSTANTS,
  CHARSET,
  bytesToWords,
  createChecksum,
  decode,
  encode,
  expandHrp,
  parseHex,
  polymod,
  toHex,
  wordsToBytes,
} from '../src/bech32.js';
import { BechError } from '../src/errors.js';
import { decodeRequest, encodeRequest, roundTripHex } from '../src/service.js';
import { ExampleStore } from '../src/store.js';

test('标准空数据向量分别识别 bech32 与 bech32m', () => {
  const bech32 = decode('A12UEL5L');
  const bech32m = decode('A1LQFN3A');
  assert.equal(bech32.variant, 'bech32');
  assert.equal(bech32.normalized, 'a12uel5l');
  assert.deepEqual(bech32.data, []);
  assert.equal(bech32.diagnostics.finalPolymod, CONSTANTS.bech32);
  assert.equal(bech32m.variant, 'bech32m');
  assert.equal(bech32m.normalized, 'a1lqfn3a');
  assert.deepEqual(bech32m.data, []);
  assert.equal(bech32m.diagnostics.finalPolymod, CONSTANTS.bech32m);
});

test('HRP 展开使用右移五位和低五位', () => {
  assert.deepEqual(expandHrp('A'), [2, 0, 1]);
  assert.deepEqual(expandHrp('a'), [3, 0, 1]);
  assert.deepEqual(expandHrp('ab'), [3, 3, 0, 1, 2]);
});

test('polymod 对标准空字符串返回最终常数', () => {
  assert.equal(polymod([...expandHrp('a'), 10, 28, 25, 31, 20, 31]).value, 1);
  assert.equal(polymod([...expandHrp('a'), 31, 0, 9, 19, 17, 29]).value, 0x2bc830a3);
  for (const value of [polymod(Array.from({ length: 250 }, () => 0)).value, polymod([...expandHrp('z'.repeat(40))]).value]) {
    assert.ok(value >= 0 && value <= 0x3fffffff);
  }
});

test('已知短字节向量与字节往返', () => {
  assert.deepEqual(bytesToWords([0x00]), [0, 0]);
  assert.deepEqual(bytesToWords([0xff]), [31, 28]);
  assert.equal(encode({ hrp: 'ts', data: [0, 0], variant: 'bech32' }), 'ts1qqw2d30k');
  assert.equal(encode({ hrp: 'ts', data: [31, 28], variant: 'bech32m' }), 'ts1lu7rj2gs');
  const trip = roundTripHex('001122ff', 'bech32m', 'tb') as { encoded: { hex: string | null }; decoded: { hex: string | null } };
  assert.equal(trip.encoded.hex, '001122ff');
  assert.equal(trip.decoded.hex, '001122ff');
  assert.deepEqual(parseHex(trip.encoded.hex ?? ''), [0, 17, 34, 255]);
  assert.equal(toHex(wordsToBytes(bytesToWords([7, 255])).bytes), '07ff');
});

test('全大写规范化但不改变数据，混合大小写拒绝', () => {
  const upper = decode('TS1LU7RJ2GS', 'ts');
  assert.equal(upper.normalized, 'ts1lu7rj2gs');
  assert.deepEqual(upper.data, [31, 28]);
  assert.throws(() => decode('TS1lu7rj2gs'), (error: BechError) => error.code === 'INVALID_CASE');
});

test('多个 1 时最后一个是分隔符', () => {
  const hrp = 'a1b';
  const text = encode({ hrp, data: [1, 2, 3], variant: 'bech32m' });
  const decoded = decode(text);
  assert.equal(decoded.hrp, hrp);
  assert.equal(decoded.diagnostics.separatorIndex, text.lastIndexOf('1'));
  assert.equal(decoded.hrp, hrp);
});

test('翻转字符只报校验失败，不自动纠错', () => {
  const original = encodeRequest({ hrp: 'demo', hex: '00ff', variant: 'bech32m' }).output;
  const replacement = original.endsWith('q') ? 'p' : 'q';
  const corrupted = `${original.slice(0, -1)}${replacement}`;
  assert.throws(() => decode(corrupted), (error: BechError) => error.code === 'INVALID_CHECKSUM');
});

test('校验正确但字节填充无效时返回独立诊断', () => {
  const nonzero = decodeRequest({ input: 'a1lacwuu8k', mode: 'bytes' }) as Record<string, unknown> & { byteError: { code: string; innerCode: string } };
  assert.equal(nonzero.valid, true);
  assert.equal(nonzero.byteConversionValid, false);
  assert.equal(nonzero.byteError.code, 'VALID_CHECKSUM_INVALID_BYTES');
  assert.equal(nonzero.byteError.innerCode, 'INVALID_PADDING_NONZERO');

  const extra = decodeRequest({ input: 'a1q3g6mn3', mode: 'bytes' }) as Record<string, unknown> & { byteError: { innerCode: string } };
  assert.equal(extra.byteConversionValid, false);
  assert.equal(extra.byteError.innerCode, 'INVALID_PADDING_EXTRA_GROUP');
});

test('长度、空前缀、字符表和短校验错误码明确', () => {
  const tooLong = `${'a'.repeat(84)}1${'q'.repeat(7)}`;
  assert.equal(tooLong.length, 92);
  assert.throws(() => decode(tooLong), (error: BechError) => error.code === 'INVALID_LENGTH');
  assert.throws(() => decode('1qqqqqq'), (error: BechError) => error.code === 'INVALID_HRP');
  assert.throws(() => decode('a1bqqqqq'), (error: BechError) => error.code === 'INVALID_CHARACTER');
  assert.throws(() => decode('a1qqqqq'), (error: BechError) => error.code === 'CHECKSUM_TOO_SHORT');
});

test('90 字符边界接受，91 字符拒绝', () => {
  const hrp = 'a';
  const dataLength = 90 - hrp.length - 1 - 6;
  const data = Array.from({ length: dataLength }, () => 0);
  const text = encode({ hrp, data, variant: 'bech32' });
  assert.equal(text.length, 90);
  assert.equal(decode(text).data.length, dataLength);
  assert.throws(() => decode(`${text}q`), (error: BechError) => error.code === 'INVALID_LENGTH');
});

test('变体和预期 HRP 均不会被错误接受', () => {
  assert.throws(
    () => decode('A12UEL5L', 'b'),
    (error: BechError) => error.code === 'HRP_MISMATCH' && decode('A12UEL5L').variant === 'bech32',
  );
  assert.throws(
    () => decodeRequest({ input: 'A12UEL5L', expectedVariant: 'bech32m' }),
    (error: BechError) => error.code === 'UNKNOWN_VARIANT',
  );
});

test('hex 与五位数组互斥且校验字使用完整字符表', () => {
  assert.throws(() => encodeRequest({ hrp: 'a', hex: '00', data: [0] }), (error: BechError) => error.code === 'INPUT_CONFLICT');
  assert.equal(new Set(CHARSET).size, 32);
  assert.deepEqual(createChecksum('a', [], 'bech32'), [10, 28, 25, 31, 20, 31]);
  assert.deepEqual(createChecksum('a', [], 'bech32m'), [31, 0, 9, 19, 17, 29]);
});

test('SQLite 保存修订版本并保留原始大小写和错误字节诊断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bech32-'));
  try {
    const store = new ExampleStore(join(dir, 'examples.sqlite'));
    const original = decode('A1LQFN3A');
    const invalid = decodeRequest({ input: 'a1lmyple6', mode: 'bytes' });
    const first = store.save({
      name: 'case',
      kind: 'decode',
      originalInput: 'A1LQFN3A',
      normalizedString: original.normalized,
      variant: original.variant,
      data: original.data,
      diagnostics: original,
    });
    const second = store.save({
      name: 'case',
      kind: 'invalid-bytes',
      originalInput: 'a1lmyple6',
      normalizedString: invalid.normalized,
      variant: invalid.variant,
      data: invalid.data,
      diagnostics: invalid,
    });
    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    const history = store.history('case');
    assert.equal(history[0]?.originalInput, 'A1LQFN3A');
    assert.equal(history[1]?.diagnostics.byteConversionValid, false);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
