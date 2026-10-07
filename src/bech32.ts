import { BechError } from './errors.js';

export type Variant = 'bech32' | 'bech32m';

export const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const INDEX = new Map<string, number>([...CHARSET].map((char, index) => [char, index]));
export const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
export const CONSTANTS = {
  bech32: 1,
  bech32m: 0x2bc830a3,
} as const;
const MAX_LENGTH = 90;
const CHECKSUM_LENGTH = 6;
const FIVE_BIT_MASK = 31;
const THIRTY_BIT_MASK = 0x3fffffff;

export type PolymodStep = {
  input: number;
  top: number;
  beforeGenerator: number;
  toggled: number[];
  state: number;
};

export type ExplainResult = {
  hrp: string;
  expandedHrp: number[];
  values: number[];
  polymodSteps: PolymodStep[];
  checksumValues: number[];
  checksumConstant: number;
  finalPolymod: number;
};

export type EncodeInput = {
  hrp: string;
  data: number[];
  variant: Variant;
};

export type DecodeResult = {
  original: string;
  normalized: string;
  hrp: string;
  data: number[];
  checksum: number[];
  variant: Variant;
  valid: true;
  diagnostics: {
    length: number;
    finalPolymod: number;
    separatorIndex: number;
    casePolicy: 'lowercase' | 'uppercase-normalized';
  };
};

function assertFiveBitValues(values: readonly number[]): void {
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 31) {
      throw new BechError('INVALID_FIVE_BIT_VALUE', '五位数组只能包含 0 到 31 的整数', { value });
    }
  }
}

export function validateHrp(hrp: string): void {
  if (hrp.length === 0) {
    throw new BechError('INVALID_HRP', 'HRP 不能为空');
  }
  for (const char of hrp) {
    const code = char.charCodeAt(0);
    if (code < 33 || code > 126) {
      throw new BechError('INVALID_HRP', 'HRP 只能包含 ASCII 33 到 126 的字符', { character: char, code });
    }
  }
}

export function expandHrp(hrp: string): number[] {
  validateHrp(hrp);
  return [
    ...[...hrp].map((char) => char.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((char) => char.charCodeAt(0) & FIVE_BIT_MASK),
  ];
}

export function polymod(values: readonly number[], collectSteps = false): { value: number; steps: PolymodStep[] } {
  let chk = 1;
  const steps: PolymodStep[] = [];

  for (const value of values) {
    const top = chk >>> 25;
    const beforeGenerator = ((chk & 0x1fffffff) << 5) ^ value;
    let next = beforeGenerator;
    const toggled: number[] = [];

    for (let index = 0; index < GENERATORS.length; index += 1) {
      if (((top >>> index) & 1) !== 0) {
        next ^= GENERATORS[index]!;
        toggled.push(index);
      }
    }

    chk = next >>> 0;
    if (collectSteps) {
      steps.push({ input: value, top, beforeGenerator: beforeGenerator >>> 0, toggled, state: chk & THIRTY_BIT_MASK });
    }
  }

  return { value: chk & THIRTY_BIT_MASK, steps };
}

export function createChecksum(hrp: string, data: readonly number[], variant: Variant): number[] {
  const values = [...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values).value ^ CONSTANTS[variant];
  return Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & FIVE_BIT_MASK);
}

export function encode({ hrp, data, variant }: EncodeInput): string {
  const normalizedHrp = normalizeEncodingHrp(hrp);
  assertFiveBitValues(data);
  const checksum = createChecksum(normalizedHrp, data, variant);
  const combined = [...data, ...checksum];
  const output = `${normalizedHrp}1${combined.map((value) => CHARSET[value]).join('')}`;
  if (output.length > MAX_LENGTH) {
    throw new BechError('INVALID_LENGTH', `编码结果总长度不能超过 ${MAX_LENGTH}`);
  }
  return output;
}

function normalizeEncodingHrp(hrp: string): string {
  validateHrp(hrp);
  if (hrp !== hrp.toLowerCase() && hrp !== hrp.toUpperCase()) {
    throw new BechError('INVALID_CASE', '编码 HRP 必须统一大小写');
  }
  return hrp.toLowerCase();
}

export function decode(input: string, expectedHrp?: string): DecodeResult {
  if (typeof input !== 'string') {
    throw new BechError('MISSING_INPUT', '待解码字符串必须是文本');
  }
  if (input.length > MAX_LENGTH) {
    throw new BechError('INVALID_LENGTH', `输入总长度不能超过 ${MAX_LENGTH}`);
  }

  const hasLower = /[a-z]/.test(input);
  const hasUpper = /[A-Z]/.test(input);
  if (hasLower && hasUpper) {
    throw new BechError('INVALID_CASE', '不能混合大小写');
  }

  const normalized = input.toLowerCase();
  const separatorIndex = normalized.lastIndexOf('1');
  if (separatorIndex < 0) {
    throw new BechError('MISSING_SEPARATOR', '必须包含分隔符 1');
  }

  const hrp = normalized.slice(0, separatorIndex);
  validateHrp(hrp);

  const payloadText = normalized.slice(separatorIndex + 1);
  if (payloadText.length < CHECKSUM_LENGTH) {
    throw new BechError('CHECKSUM_TOO_SHORT', '分隔符之后至少需要六个校验字符');
  }

  const payload: number[] = [];
  for (const char of payloadText) {
    const value = INDEX.get(char);
    if (value === undefined) {
      throw new BechError('INVALID_CHARACTER', `字符 ${char} 不在 Bech32 字符表中`, { character: char });
    }
    payload.push(value);
  }

  const data = payload.slice(0, payload.length - CHECKSUM_LENGTH);
  const checksum = payload.slice(payload.length - CHECKSUM_LENGTH);
  const finalPolymod = polymod([...expandHrp(hrp), ...payload]).value;

  let variant: Variant | undefined;
  if (finalPolymod === CONSTANTS.bech32) variant = 'bech32';
  if (finalPolymod === CONSTANTS.bech32m) variant = 'bech32m';
  if (!variant) {
    throw new BechError('INVALID_CHECKSUM', '校验余数不匹配 Bech32 或 Bech32m，字符串可能已损坏', { finalPolymod });
  }

  if (expectedHrp !== undefined) {
    const expected = normalizeEncodingHrp(expectedHrp);
    if (expected !== hrp) {
      throw new BechError('HRP_MISMATCH', '预期 HRP 与字符串 HRP 不一致', { expected, actual: hrp });
    }
  }

  return {
    original: input,
    normalized,
    hrp,
    data,
    checksum,
    variant,
    valid: true,
    diagnostics: {
      length: input.length,
      finalPolymod,
      separatorIndex,
      casePolicy: hasUpper ? 'uppercase-normalized' : 'lowercase',
    },
  };
}

export function explain(hrp: string, data: readonly number[], variant: Variant): ExplainResult {
  const normalizedHrp = normalizeEncodingHrp(hrp);
  assertFiveBitValues(data);
  const expandedHrp = expandHrp(normalizedHrp);
  const checksumValues = createChecksum(normalizedHrp, data, variant);
  const values = [...expandedHrp, ...data, ...checksumValues];
  const { value: finalPolymod, steps } = polymod(values, true);
  return {
    hrp: normalizedHrp,
    expandedHrp,
    values,
    polymodSteps: steps,
    checksumValues,
    checksumConstant: CONSTANTS[variant],
    finalPolymod,
  };
}

export function bytesToWords(bytes: readonly number[]): number[] {
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new BechError('INVALID_FIVE_BIT_VALUE', '字节只能是 0 到 255 的整数', { value: byte });
    }
  }

  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = ((accumulator << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5) {
      words.push((accumulator >>> (bits - 5)) & FIVE_BIT_MASK);
      bits -= 5;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    words.push((accumulator << (5 - bits)) & FIVE_BIT_MASK);
  }
  return words;
}

export function wordsToBytes(words: readonly number[]): { bytes: number[]; paddingBits: number; residual: number } {
  assertFiveBitValues(words);
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;

  for (const word of words) {
    accumulator = ((accumulator << 5) | word) >>> 0;
    bits += 5;
    while (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
      accumulator &= (1 << bits) - 1;
    }
  }

  if (bits >= 5) {
    throw new BechError('INVALID_PADDING_EXTRA_GROUP', '末尾存在一整组多余五位填充', { paddingBits: bits, residual: accumulator });
  }
  if (bits > 0 && accumulator !== 0) {
    throw new BechError('INVALID_PADDING_NONZERO', '末尾残余位必须全部为零', { paddingBits: bits, residual: accumulator });
  }
  return { bytes, paddingBits: bits, residual: accumulator };
}

export function parseHex(hex: string): number[] {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(clean)) {
    throw new BechError('INVALID_HEX', '十六进制必须是偶数个 0-9a-f 字符');
  }
  return clean.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
}

export function toHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
