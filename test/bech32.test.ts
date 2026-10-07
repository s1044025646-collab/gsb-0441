import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encode, decode, encodeBytes, decodeBytes, convertBits, bytesToWords, wordsToBytes,
  hexToBytes, polymod, hrpExpand, CHARSET, MAX_LENGTH,
} from '../src/bech32';
import { Bech32Error } from '../src/errors';

// 标准测试向量（BIP-173 有效 Bech32）
const VALID_BECH32 = [
  'A12UEL5L',
  'a12uel5l',
  'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
  'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
  '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
  'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
  '?1ezyfcl',
];

// BIP-350 有效 Bech32m
const VALID_BECH32M = [
  'A1LQFN3A',
  'a1lqfn3a',
  'an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6',
  'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
  '11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8',
  'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
  '?1v759aa',
];

test('polymod 独立核对：BIP 标准向量 + 校验字构造性质', () => {
  // 1) 官方向量直接验证 polymod 终值（不经过本实现的 encode/decode）
  for (const s of [...VALID_BECH32, ...VALID_BECH32M]) {
    const lower = s.toLowerCase();
    const pos = lower.lastIndexOf('1');
    const hrp = lower.slice(0, pos);
    const words = [...lower.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
    const expect = VALID_BECH32.map((x) => x.toLowerCase()).includes(lower) ? 1 : 0x2bc830a3;
    assert.equal(polymod(hrpExpand(hrp).concat(words)), expect, s);
  }
  // 2) 随机输入：手工把 6 个校验字拼上后，polymod 必等于对应常数
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let t = 0; t < 200; t++) {
    const hrp = 'h' + String(rand() % 1000);
    const data = Array.from({ length: rand() % 30 }, () => rand() % 32);
    for (const variant of ['bech32', 'bech32m'] as const) {
      const enc = encode(hrp, data, variant);
      const words = [...enc.bech.slice(enc.bech.lastIndexOf('1') + 1)].map((c) => CHARSET.indexOf(c));
      const expect = variant === 'bech32' ? 1 : 0x2bc830a3;
      assert.equal(polymod(hrpExpand(hrp).concat(words)), expect);
    }
  }
});

test('标准空数据例 A12UEL5L=bech32, A1LQFN3A=bech32m', () => {
  assert.equal(decode('A12UEL5L').variant, 'bech32');
  assert.equal(decode('A1LQFN3A').variant, 'bech32m');
  assert.equal(decode('A12UEL5L').data.length, 0);
  assert.equal(decode('A1LQFN3A').data.length, 0);
});

test('BIP-173 有效向量全部识别为 bech32', () => {
  for (const s of VALID_BECH32) assert.equal(decode(s).variant, 'bech32', s);
});

test('BIP-350 有效向量识别（区分两变体，互不误认）', () => {
  for (const s of VALID_BECH32M) assert.equal(decode(s).variant, 'bech32m', s);
  // 同一 HRP+数据用两种常数编码，解码必须各自识别
  const data = [1, 2, 3, 4, 5];
  const b1 = encode('test', data, 'bech32');
  const b2 = encode('test', data, 'bech32m');
  assert.notEqual(b1.bech, b2.bech);
  assert.equal(decode(b1.bech).variant, 'bech32');
  assert.equal(decode(b2.bech).variant, 'bech32m');
});

test('编码->解码往返（含空数据、最长边界）', () => {
  for (const variant of ['bech32', 'bech32m'] as const) {
    const r0 = encode('a', [], variant);
    assert.deepEqual(decode(r0.bech).data, []);
    // 最长边界：hrp=1 + 分隔符 + 82 字 = 84... 凑满 90
    const hrp = 'x';
    const maxData = MAX_LENGTH - hrp.length - 1 - 6;
    const data = Array.from({ length: maxData }, (_, i) => i % 32);
    const r = encode(hrp, data, variant);
    assert.equal(r.bech.length, MAX_LENGTH);
    assert.deepEqual(decode(r.bech).data, data);
    // 超长拒绝
    assert.throws(() => encode(hrp, [...data, 0], variant), (e: any) => e.code === 'E_LENGTH');
  }
});

test('末位字符翻转导致校验失败', () => {
  const good = encode('flip', [7, 7, 7], 'bech32').bech;
  const last = good[good.length - 1];
  const alt = CHARSET[(CHARSET.indexOf(last) + 1) % 32];
  const bad = good.slice(0, -1) + alt;
  assert.throws(() => decode(bad), (e: any) => e.code === 'E_CHECKSUM');
});

test('多个分隔符：取最后一个 1，前缀可含 1', () => {
  const r = encode('a1b', [0, 0], 'bech32');
  const d = decode(r.bech);
  assert.equal(d.hrp, 'a1b');
  assert.deepEqual(d.data, [0, 0]);
});

test('混合大小写拒绝；全大写/全小写接受且数据一致', () => {
  const lower = encode('Case', [1, 2, 3], 'bech32').bech;
  const upper = lower.toUpperCase();
  assert.deepEqual(decode(lower).data, decode(upper).data);
  const mixed = lower.slice(0, 2).toUpperCase() + lower.slice(2);
  assert.throws(() => decode(mixed), (e: any) => e.code === 'E_CASE');
});

test('空前缀与非法前缀字符拒绝', () => {
  assert.throws(() => encode('', [0], 'bech32'), (e: any) => e.code === 'E_HRP_EMPTY');
  assert.throws(() => decode('1qqqqqq'), (e: any) => e.code === 'E_HRP_EMPTY');
  assert.throws(() => encode('a b', [0], 'bech32'), (e: any) => e.code === 'E_HRP_CHAR');
  assert.throws(() => encode('é', [0], 'bech32'), (e: any) => e.code === 'E_HRP_CHAR');
});

test('校验区不足 6 字与非法字符', () => {
  assert.throws(() => decode('a1qqq'), (e: any) => e.code === 'E_CHECKSUM_SHORT');
  const good = encode('cs', [0], 'bech32').bech;
  const bad = good.slice(0, -1) + 'b'; // 'b' 不在字符表
  assert.throws(() => decode(bad), (e: any) => e.code === 'E_CHARSET');
  assert.throws(() => decode('a1qqqqqb'), (e: any) => e.code === 'E_CHARSET');
});

test('预期前缀不符即使校验正确也拒绝', () => {
  const good = encode('real', [5, 6], 'bech32m').bech;
  assert.throws(() => decode(good, 'fake'), (e: any) => e.code === 'E_PREFIX_MISMATCH');
  assert.equal(decode(good, 'REAL').hrp, 'real'); // 大小写不敏感
});

test('convertBits：编码补零，解码拒绝非零残余与整组多余填充', () => {
  assert.deepEqual(convertBits([0xff], 8, 5, true), [31, 28]); // 11111 111(00)
  assert.throws(() => convertBits([31, 29], 5, 8, false), (e: any) => e.code === 'E_PADDING'); // 非零残余
  assert.throws(() => convertBits([0, 0, 0], 5, 8, false), (e: any) => e.code === 'E_PADDING'); // 整组多余填充
  assert.deepEqual(convertBits([31, 28], 5, 8, false), [0xff]); // 残余全零合法
});

test('字节往返：随机字节块 8->5->8 一致', () => {
  let seed = 999;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let t = 0; t < 100; t++) {
    const len = rand() % 20;
    const bytes = Array.from({ length: len }, () => rand() % 256);
    assert.deepEqual(wordsToBytes(bytesToWords(bytes)), bytes);
  }
});

test('零字节数据：空 hex 编码为空数据串', () => {
  const r = encodeBytes('z', [], 'bech32');
  assert.deepEqual(r.words, []);
  const d = decodeBytes(r.bech);
  assert.deepEqual(d.bytes, []);
});

test('校验正确但字节填充不合规：E_PADDING 与 E_CHECKSUM 区分', () => {
  const bad = encode('pad', [1], 'bech32').bech; // 校验有效
  assert.equal(decode(bad).variant, 'bech32');    // 低层解码通过
  assert.throws(() => decodeBytes(bad), (e: any) => e.code === 'E_PADDING'); // 字节模式单独拒绝
});

test('未知变体与互斥输入', () => {
  assert.throws(() => encode('a', [0], 'bech32x' as any), (e: any) => e.code === 'E_VARIANT');
  assert.throws(() => hexToBytes('abc'), (e: any) => e.code === 'E_INPUT');
  assert.throws(() => encode('a', [32], 'bech32'), (e: any) => e.code === 'E_DATA_WORD');
});

test('规范化只改变大小写，不改变数据含义', () => {
  const upper = 'A12UEL5L';
  const d1 = decode(upper);
  const d2 = decode(upper.toLowerCase());
  assert.equal(d1.normalized, d2.normalized);
  assert.deepEqual(d1.data, d2.data);
  assert.equal(d1.original, upper); // 原输入大小写保留
});

test('hrpExpand 结构正确', () => {
  // 'A' = 0x41: >>5 = 2, &31 = 1
  assert.deepEqual(hrpExpand('A'), [2, 0, 1]);
  assert.deepEqual(hrpExpand('ab'), [3, 3, 0, 1, 2]);
});

test('SQLite 持久化：保存、版本递增、重启后可复核', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), `bech32-test-${Date.now()}.db`);
  process.env.BECH32_DB = tmp;
  const { CaseStore } = await import('../src/db.js');
  const s1 = new CaseStore(tmp);
  const good = encode('persist', [9, 9], 'bech32').bech;
  const d = decode(good);
  const rec = {
    original: d.original, normalized: d.normalized, variant: d.variant, hrp: d.hrp,
    data: JSON.stringify(d.data), bytesHex: null, ok: 1, errorCode: null,
    diagnostics: JSON.stringify(d.diagnostics),
  };
  const v1 = s1.save(rec);
  const v2 = s1.save({ ...rec, original: good.toUpperCase() }); // 修订另建版本
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  s1.close();
  // 模拟重启：重新打开数据库
  const s2 = new CaseStore(tmp);
  const all = s2.list();
  assert.equal(all.length, 2);
  assert.equal(s2.get(v1.id).original, good); // 原始大小写未被覆盖
  s2.close();
  fs.unlinkSync(tmp);
});
