import {
  decode,
  encode,
  explain,
  parseHex,
  toHex,
  bytesToWords,
  wordsToBytes,
  type Variant,
} from './bech32.js';
import { BechError } from './errors.js';

export type EncodeRequest = {
  hrp: string;
  variant?: Variant;
  data?: number[];
  hex?: string;
};

export type DecodeRequest = {
  input: string;
  expectedHrp?: string;
  mode?: 'words' | 'bytes';
  expectedVariant?: Variant;
};

export function encodeRequest(request: EncodeRequest) {
  if (request.hex !== undefined && request.data !== undefined) {
    throw new BechError('INPUT_CONFLICT', 'hex 与 data 互斥，只能提供一种输入');
  }
  const variant = request.variant ?? 'bech32';
  const source = request.hex !== undefined ? 'hex' : 'five-bit-data';
  const bytes = request.hex !== undefined ? parseHex(request.hex) : undefined;
  const data = bytes ? bytesToWords(bytes) : (request.data ?? []);
  const output = encode({ hrp: request.hrp, data, variant });
  return {
    output,
    normalized: output,
    variant,
    hrp: request.hrp.toLowerCase(),
    data,
    bytes: bytes ?? null,
    hex: bytes ? toHex(bytes) : null,
    source,
    paddingBits: bytes ? (5 - ((bytes.length * 8) % 5)) % 5 : 0,
  };
}

export function decodeRequest(request: DecodeRequest) {
  const decoded = decode(request.input, request.expectedHrp);
  if (request.expectedVariant && request.expectedVariant !== decoded.variant) {
    throw new BechError('UNKNOWN_VARIANT', '检测到的变体与预期变体不一致', {
      expected: request.expectedVariant,
      actual: decoded.variant,
    });
  }

  if (request.mode === 'bytes') {
    try {
      const conversion = wordsToBytes(decoded.data);
      return {
        ...decoded,
        mode: 'bytes',
        bytes: conversion.bytes,
        hex: toHex(conversion.bytes),
        bytePadding: conversion,
        byteConversionValid: true as const,
      };
    } catch (error) {
      if (error instanceof BechError && (error.code === 'INVALID_PADDING_NONZERO' || error.code === 'INVALID_PADDING_EXTRA_GROUP')) {
        return {
          ...decoded,
          mode: 'bytes',
          bytes: null,
          hex: null,
          bytePadding: error.details ?? null,
          byteConversionValid: false as const,
          byteError: {
            code: 'VALID_CHECKSUM_INVALID_BYTES' as const,
            innerCode: error.code,
            message: error.message,
          },
        };
      }
      throw error;
    }
  }

  return { ...decoded, mode: 'words' as const };
}

export function explainRequest(hrp: string, data: number[], variant: Variant) {
  return explain(hrp, data, variant);
}

export function roundTripHex(hex: string, variant: Variant, hrp: string) {
  const encoded = encodeRequest({ hrp, hex, variant });
  const decoded = decodeRequest({ input: encoded.output, mode: 'bytes' });
  return { encoded, decoded };
}
