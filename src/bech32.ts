import { Bech32Error } from './errors';

export const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARSET_REV: Record<string, number> = {};
for (let i = 0; i < CHARSET.length; i++) CHARSET_REV[CHARSET[i]] = i;

const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export const BECH32_CONST = 1;
export const BECH32M_CONST = 0x2bc830a3;
export const MAX_LENGTH = 90;

export type Variant = 'bech32' | 'bech32m';

/** HRP 展开：每个字符码右移 5 位，接一个 0，再接每个字符码的低 5 位。 */
export function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * 校验核心。JavaScript 位运算为 32 位有符号，但本实现每步都与 0x3fffffff
 * 相与，状态始终保持 30 位无符号，移位只取最高 5 位（>>> 25）。
 */
export function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
    chk &= 0x3fffffff; // 保持 30 位校验状态
  }
  return chk >>> 0;
}

/** 返回校验步骤明细，供诊断/教学展示。 */
export function polymodSteps(values: number[]): { input: number; top: number; state: number }[] {
  const steps: { input: number; top: number; state: number }[] = [];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
    chk &= 0x3fffffff;
    steps.push({ input: v, top, state: chk >>> 0 });
  }
  return steps;
}

export function validateHrp(hrp: string): void {
  if (hrp.length === 0) throw new Bech32Error('E_HRP_EMPTY', 'HRP 不能为空');
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) {
      throw new Bech32Error('E_HRP_CHAR', `HRP 含非法字符（码 ${c}），仅允许 ASCII 33..126`);
    }
  }
}

export function validateWords(data: number[]): void {
  for (const w of data) {
    if (!Number.isInteger(w) || w < 0 || w > 31) {
      throw new Bech32Error('E_DATA_WORD', `五位字必须为 0..31 的整数，收到 ${w}`);
    }
  }
}

function createChecksum(hrp: string, data: number[], variant: Variant): number[] {
  const constant = variant === 'bech32' ? BECH32_CONST : BECH32M_CONST;
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ constant;
  const out: number[] = [];
  for (let p = 0; p < 6; p++) out.push((mod >>> (5 * (5 - p))) & 31);
  return out;
}

export interface EncodeResult {
  bech: string;       // 统一小写输出
  hrp: string;
  data: number[];
  checksum: number[];
  variant: Variant;
}

export function encode(hrpInput: string, data: number[], variant: Variant = 'bech32'): EncodeResult {
  if (variant !== 'bech32' && variant !== 'bech32m') {
    throw new Bech32Error('E_VARIANT', `未知变体: ${variant}`);
  }
  const hrp = hrpInput.toLowerCase();
  validateHrp(hrp);
  validateWords(data);
  const checksum = createChecksum(hrp, data, variant);
  const combined = data.concat(checksum);
  let bech = hrp + '1';
  for (const w of combined) bech += CHARSET[w];
  if (bech.length > MAX_LENGTH) {
    throw new Bech32Error('E_LENGTH', `编码结果长度 ${bech.length} 超过 ${MAX_LENGTH}`);
  }
  return { bech, hrp, data: data.slice(), checksum, variant };
}

export interface DecodeResult {
  original: string;      // 原输入（保留大小写）
  normalized: string;    // 小写规范化
  hrp: string;
  data: number[];        // 不含校验字的五位数据
  checksum: number[];
  variant: Variant;
  diagnostics: string[];
}

export function decode(input: string, expectedHrp?: string): DecodeResult {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Bech32Error('E_INPUT', '输入不能为空');
  }
  if (input.length > MAX_LENGTH) {
    throw new Bech32Error('E_LENGTH', `长度 ${input.length} 超过 ${MAX_LENGTH}`);
  }
  const hasLower = /[a-z]/.test(input);
  const hasUpper = /[A-Z]/.test(input);
  if (hasLower && hasUpper) {
    throw new Bech32Error('E_CASE', '不允许混合大小写');
  }
  const normalized = input.toLowerCase();
  const pos = normalized.lastIndexOf('1');
  if (pos < 0) throw new Bech32Error('E_NO_SEPARATOR', '缺少分隔符 1');
  if (pos === 0) throw new Bech32Error('E_HRP_EMPTY', '分隔符前的前缀为空');
  const hrp = normalized.slice(0, pos);
  validateHrp(hrp);
  const payload = normalized.slice(pos + 1);
  if (payload.length < 6) {
    throw new Bech32Error('E_CHECKSUM_SHORT', '分隔符之后至少需要 6 个校验字');
  }
  const words: number[] = [];
  for (const ch of payload) {
    const v = CHARSET_REV[ch];
    if (v === undefined) throw new Bech32Error('E_CHARSET', `字符 '${ch}' 不在 Bech32 字符表中`);
    words.push(v);
  }
  const data = words.slice(0, words.length - 6);
  const checksum = words.slice(words.length - 6);
  const mod = polymod(hrpExpand(hrp).concat(words));
  let variant: Variant;
  if (mod === BECH32_CONST) variant = 'bech32';
  else if (mod === BECH32M_CONST) variant = 'bech32m';
  else {
    throw new Bech32Error(
      'E_CHECKSUM',
      `校验和失败：polymod = 0x${mod.toString(16)}，既非 Bech32(1) 也非 Bech32m(0x2bc830a3)`,
    );
  }
  const diagnostics = [
    `polymod=0x${mod.toString(16)}`,
    `variant=${variant}`,
    `hrp=${hrp}`,
    `dataWords=${data.length}`,
  ];
  if (expectedHrp !== undefined && hrp !== expectedHrp.toLowerCase()) {
    throw new Bech32Error(
      'E_PREFIX_MISMATCH',
      `前缀不符：期望 ${expectedHrp.toLowerCase()}，实际 ${hrp}（校验和本身有效）`,
    );
  }
  return { original: input, normalized, hrp, data, checksum, variant, diagnostics };
}

/**
 * 通用位组转换。pad=true（编码方向）允许末尾补零；
 * pad=false（解码方向）拒绝非零残余位与一整组多余填充。
 */
export function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  const out: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Bech32Error('E_DATA_WORD', `值 ${value} 超出 ${fromBits} 位范围`);
    }
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else {
    if (bits >= fromBits) {
      throw new Bech32Error('E_PADDING', '存在一整组多余的填充位');
    }
    if (((acc << (toBits - bits)) & maxv) !== 0) {
      throw new Bech32Error('E_PADDING', '末尾残余位非零，字节填充不合规');
    }
  }
  return out;
}

export function bytesToWords(bytes: number[]): number[] {
  return convertBits(bytes, 8, 5, true);
}

export function wordsToBytes(words: number[]): number[] {
  return convertBits(words, 5, 8, false);
}

export function hexToBytes(hex: string): number[] {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Bech32Error('E_INPUT', '十六进制输入必须为偶数长度的 hex 字符');
  }
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ByteEncodeResult extends EncodeResult {
  inputHex: string;
  words: number[];
}

/** 字节模式编码：8 位字节 -> 5 位组（末尾补零）-> Bech32/Bech32m。 */
export function encodeBytes(hrp: string, bytes: number[], variant: Variant = 'bech32'): ByteEncodeResult {
  const words = bytesToWords(bytes);
  const res = encode(hrp, words, variant);
  return { ...res, inputHex: bytesToHex(bytes), words };
}

export interface ByteDecodeResult extends DecodeResult {
  bytes: number[];
  hex: string;
  paddingValid: true;
}

/**
 * 字节模式解码：先做 Bech32 校验，再单独核验 5->8 位填充。
 * 校验通过但填充不合规时抛出 E_PADDING，与校验失败区分。
 */
export function decodeBytes(input: string, expectedHrp?: string): ByteDecodeResult {
  const dec = decode(input, expectedHrp); // 可能抛 E_CHECKSUM 等
  const bytes = wordsToBytes(dec.data);   // 可能抛 E_PADDING
  return { ...dec, bytes, hex: bytesToHex(bytes), paddingValid: true };
}
