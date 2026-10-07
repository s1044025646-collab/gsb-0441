import { encode, decode, encodeBytes, decodeBytes, hexToBytes, bytesToHex } from './bech32';
import { Bech32Error } from './errors';

function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

section('标准空数据校验例');
for (const s of ['A12UEL5L', 'A1LQFN3A']) {
  const r = decode(s);
  console.log(`${s} -> variant=${r.variant} hrp=${r.hrp} data=[${r.data.join(',')}]`);
}

section('任意短字节块编码后解码往返');
const bytes = hexToBytes('deadbeef00');
const enc = encodeBytes('demo', bytes, 'bech32m');
const dec = decodeBytes(enc.bech, 'demo');
console.log(`字节: ${bytesToHex(bytes)} -> ${enc.bech} -> ${dec.hex}（一致: ${dec.hex === bytesToHex(bytes)}）`);

section('翻转一个字符导致校验失败');
const good = enc.bech;
const pos = good.length - 3;
const flipped = good.slice(0, pos) + (good[pos] === 'q' ? 'p' : 'q') + good.slice(pos + 1);
try {
  decode(flipped);
  console.log('意外通过！');
} catch (e) {
  console.log(`${flipped} -> [${(e as Bech32Error).code}] ${(e as Bech32Error).message}`);
}

section('校验正确但字节填充不合规被单独拒绝');
// 手工构造：数据末尾附加一个非零残余的五位字，使 5->8 转换留下非零残余位
const bad = encode('pad', [1], 'bech32'); // 1 个五位字 -> 5 位，残余非零
const chk = decode(bad.bech);
console.log(`${bad.bech} Bech32 校验通过（variant=${chk.variant}）`);
try {
  decodeBytes(bad.bech);
  console.log('意外通过！');
} catch (e) {
  console.log(`字节模式拒绝 -> [${(e as Bech32Error).code}] ${(e as Bech32Error).message}`);
}

section('大小写规范化');
const mixed = decode('a12uel5l');
console.log(`a12uel5l 与 A12UEL5L 数据一致: ${JSON.stringify(mixed.data) === JSON.stringify(decode('A12UEL5L').data)}`);
