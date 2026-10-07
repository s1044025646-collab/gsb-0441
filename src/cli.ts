import {
  encode, decode, encodeBytes, decodeBytes, hexToBytes, bytesToWords,
  hrpExpand, polymodSteps, bytesToHex, Variant,
} from './bech32';
import { CaseStore } from './db';
import { Bech32Error } from './errors';

function usage(): void {
  console.log(`用法: node dist/cli.js <命令> [参数]

命令:
  encode <hrp> <hex字节|w0,w1,...> [bech32|bech32m]   编码（hex 前缀 0x 可选；逗号分隔为五位字）
  decode <字符串> [--hrp 预期前缀] [--bytes]           解码并识别变体
  verify <字符串> --hrp 预期前缀                       指定前缀核验
  explain <字符串>                                     展示 HRP 展开与 polymod 每步状态
  roundtrip <hrp> <hex字节> [variant]                  字节编码->解码往返
  save <字符串> [--bytes]                              保存算例（重复保存自动升版本）
  list [n]                                             查看最近 n 条历史（默认 20）
  export                                               导出全部算例为 JSON
`);
}

function parseDataArg(arg: string): number[] {
  const clean = arg.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]*$/.test(clean) && clean.length % 2 === 0 && !clean.includes(',')) {
    return bytesToWords(hexToBytes(clean));
  }
  return arg.split(',').filter((s) => s !== '').map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Bech32Error('E_INPUT', `无法解析数据参数: ${arg}`);
    return n;
  });
}

function showDecode(r: ReturnType<typeof decode>): void {
  console.log(`原串:     ${r.original}`);
  console.log(`规范串:   ${r.normalized}`);
  console.log(`变体:     ${r.variant}`);
  console.log(`前缀:     ${r.hrp}`);
  console.log(`数据(5位): [${r.data.join(',')}]`);
  console.log(`校验字:   [${r.checksum.join(',')}]`);
  console.log(`诊断:     ${r.diagnostics.join(' | ')}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const store = new CaseStore(process.env.BECH32_DB);
  try {
    switch (cmd) {
      case 'encode': {
        const [hrp, dataArg, variant = 'bech32'] = args.slice(1);
        if (!hrp || dataArg === undefined) return usage();
        const r = encode(hrp, parseDataArg(dataArg), variant as Variant);
        console.log(`编码结果: ${r.bech}`);
        console.log(`变体: ${r.variant}  校验字: [${r.checksum.join(',')}]`);
        break;
      }
      case 'decode': {
        const input = args[1];
        if (!input) return usage();
        const hrpIdx = args.indexOf('--hrp');
        const expected = hrpIdx >= 0 ? args[hrpIdx + 1] : undefined;
        const r = args.includes('--bytes') ? decodeBytes(input, expected) : decode(input, expected);
        showDecode(r);
        if ('hex' in r) console.log(`字节(hex): ${(r as any).hex}`);
        break;
      }
      case 'verify': {
        const input = args[1];
        const hrpIdx = args.indexOf('--hrp');
        if (!input || hrpIdx < 0) return usage();
        const r = decode(input, args[hrpIdx + 1]);
        console.log(`核验通过: variant=${r.variant} hrp=${r.hrp}`);
        break;
      }
      case 'explain': {
        const input = args[1];
        if (!input) return usage();
        const r = decode(input);
        showDecode(r);
        const expanded = hrpExpand(r.hrp);
        console.log(`HRP 展开: [${expanded.join(',')}]`);
        const steps = polymodSteps(expanded.concat(r.data, r.checksum));
        console.log('polymod 步骤（输入字 -> 30 位状态）:');
        steps.forEach((s, i) => {
          console.log(`  #${String(i).padStart(2)} in=${String(s.input).padStart(2)} top=${s.top} state=0x${s.state.toString(16).padStart(8, '0')}`);
        });
        break;
      }
      case 'roundtrip': {
        const [hrp, hexArg, variant = 'bech32'] = args.slice(1);
        if (!hrp || !hexArg) return usage();
        const bytes = hexToBytes(hexArg.replace(/^0x/i, ''));
        const enc = encodeBytes(hrp, bytes, variant as Variant);
        const dec = decodeBytes(enc.bech, hrp);
        console.log(`编码: ${enc.bech}`);
        console.log(`解码字节: ${dec.hex}`);
        console.log(`往返一致: ${dec.hex === bytesToHex(bytes)}`);
        break;
      }
      case 'save': {
        const input = args[1];
        if (!input) return usage();
        try {
          const r = args.includes('--bytes') ? decodeBytes(input) : decode(input);
          const saved = store.save({
            original: r.original, normalized: r.normalized, variant: r.variant, hrp: r.hrp,
            data: JSON.stringify(r.data), bytesHex: 'hex' in r ? (r as any).hex : null,
            ok: 1, errorCode: null, diagnostics: JSON.stringify(r.diagnostics),
          });
          console.log(`已保存算例 #${saved.id}（版本 v${saved.version}）`);
        } catch (e) {
          if (e instanceof Bech32Error) {
            const saved = store.save({
              original: input, normalized: input.toLowerCase(), variant: 'unknown', hrp: '',
              data: '[]', bytesHex: null, ok: 0, errorCode: e.code,
              diagnostics: JSON.stringify([e.message]),
            });
            console.log(`解码失败（${e.code}: ${e.message}），失败算例已保存为 #${saved.id}`);
          } else throw e;
        }
        break;
      }
      case 'list': {
        const n = Number(args[1] ?? 20);
        for (const c of store.list(n)) {
          console.log(`#${c.id} v${c.version} [${c.ok ? 'OK' : c.errorCode}] ${c.variant} ${c.normalized} @${c.createdAt}`);
        }
        break;
      }
      case 'export': {
        console.log(JSON.stringify(store.list(10000), null, 2));
        break;
      }
      default:
        usage();
    }
  } catch (e) {
    if (e instanceof Bech32Error) {
      console.error(`错误 [${e.code}] ${e.message}`);
      process.exitCode = 1;
    } else throw e;
  } finally {
    store.close();
  }
}

main();
