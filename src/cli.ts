#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode, parseHex } from './bech32.js';
import { decodeRequest, encodeRequest, explainRequest, roundTripHex } from './service.js';
import { ExampleStore } from './store.js';

type Options = Map<string, string>;

const [command = '', ...rawArgs] = process.argv.slice(2);
const dataDir = option(rawArgs, '--data-dir') ?? 'data';
mkdirSync(resolve(dataDir), { recursive: true });
const store = new ExampleStore(resolve(dataDir, 'bech32-examples.sqlite'));

function main(): void {
  switch (command) {
    case 'encode':
      print(runEncode(rawArgs));
      break;
    case 'decode':
      print(runDecode(rawArgs));
      break;
    case 'verify':
      print(runDecode(rawArgs));
      break;
    case 'explain':
      print(explainRequest(required(rawArgs, '--hrp'), parseData(rawArgs), variantOption(option(rawArgs, '--variant'))));
      break;
    case 'roundtrip':
      print(roundTripHex(required(rawArgs, '--hex'), variantOption(option(rawArgs, '--variant')), option(rawArgs, '--hrp') ?? 'tb'));
      break;
    case 'save': {
      const encoded = runEncode(rawArgs);
      const result = option(rawArgs, '--mode') === 'bytes'
        ? { encoded, decoded: decodeRequest({ input: encoded.output, expectedHrp: encoded.hrp, expectedVariant: encoded.variant, mode: 'bytes' }) }
        : encoded;
      const saved = store.save({
        name: required(rawArgs, '--name'),
        kind: option(rawArgs, '--mode') ?? 'words',
        originalInput: JSON.parse(JSON.stringify(result)),
        normalizedString: encoded.normalized,
        variant: encoded.variant,
        data: encoded.data,
        diagnostics: result,
      });
      print(saved);
      break;
    }
    case 'history':
      print({ examples: store.history(option(rawArgs, '--name') ?? undefined) });
      break;
    case 'export': {
      const output = option(rawArgs, '--out') ?? resolve(dataDir, 'examples-export.json');
      const payload = { exportedAt: new Date().toISOString(), examples: store.exportJson() };
      writeFileSync(output, JSON.stringify(payload, null, 2), 'utf8');
      print({ output, count: payload.examples.length });
      break;
    }
    case 'demo':
      runDemo();
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

function runEncode(args: string[]) {
  const hex = option(args, '--hex');
  const data = option(args, '--data');
  if (hex !== undefined && data !== undefined) throw new Error('hex 与 data 互斥');
  return encodeRequest({
    hrp: required(args, '--hrp'),
    variant: variantOption(option(args, '--variant')),
    hex,
    data: data !== undefined ? parseData(args) : undefined,
  });
}

function runDecode(args: string[]) {
  const input = required(args, '--input');
  decode(input);
  return decodeRequest({
    input,
    expectedHrp: option(args, '--expect-hrp'),
    expectedVariant: option(args, '--expect-variant') === undefined ? undefined : variantOption(option(args, '--expect-variant')),
    mode: (option(args, '--mode') ?? 'words') as 'words' | 'bytes',
  });
}

function variantOption(value: string | undefined): 'bech32' | 'bech32m' {
  const normalized = value ?? 'bech32';
  if (normalized !== 'bech32' && normalized !== 'bech32m') throw new Error('variant 必须是 bech32 或 bech32m');
  return normalized;
}

function runDemo(): void {
  const bech32Empty = decode('A12UEL5L');
  const bech32mEmpty = decode('A1LQFN3A');
  const shortBytes = roundTripHex('00ff', 'bech32m', 'demo');
  let corruptedError: unknown = null;
  try {
    const corrupted = shortBytes.encoded.output.slice(0, -1) + (shortBytes.encoded.output.endsWith('l') ? 'q' : 'l');
    decode(corrupted);
  } catch (error) {
    corruptedError = serializeError(error);
  }
  const invalidPadding = decodeRequest({ input: 'a1lacwuu8k', mode: 'bytes' });
  const mixedCase = safeFail(() => decode('A12UeL5L'));
  const emptyHrp = safeFail(() => decode('12uel5l'));
  print({
    standardEmpty: { bech32Empty, bech32mEmpty },
    shortBytesRoundTrip: shortBytes,
    oneCharacterFlipped: corruptedError,
    validChecksumButInvalidBytePadding: invalidPadding,
    rejectionSamples: { mixedCase, emptyHrp },
  });
}

function safeFail(callback: () => unknown) {
  try {
    return { rejected: false, value: callback() };
  } catch (error) {
    return { rejected: true, error: serializeError(error) };
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error && 'code' in error) {
    return { code: String((error as { code: unknown }).code), message: error.message, details: (error as { details?: unknown }).details ?? null };
  }
  return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}

function parseData(args: string[]): number[] {
  const literal = option(args, '--data');
  const file = option(args, '--data-file');
  if (literal !== undefined && file !== undefined) throw new Error('--data 与 --data-file 互斥');
  const raw = file ? readFileSync(resolve(file), 'utf8') : (literal ?? '[]');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('data 必须是 JSON 数组');
  return parsed.map((value) => Number(value));
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new Error(`缺少参数 ${name}`);
  return value;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function usage(): void {
  console.log(`用法:
  npm run cli -- encode --hrp tb [--hex 00ff | --data "[0,1]"] [--variant bech32|bech32m]
  npm run cli -- decode --input a1lqfn3a [--expect-hrp a] [--expect-variant bech32m] [--mode bytes]
  npm run cli -- explain --hrp a --data "[]" --variant bech32
  npm run cli -- roundtrip --hex 00ff --hrp demo --variant bech32m
  npm run cli -- save --name demo --hrp demo --hex 00ff --variant bech32m --mode bytes
  npm run cli -- history [--name demo]
  npm run cli -- export [--out data/export.json]
  npm run cli -- demo`);
}

try {
  main();
} catch (error) {
  print({ error: serializeError(error) });
  process.exitCode = 1;
} finally {
  store.close();
}
