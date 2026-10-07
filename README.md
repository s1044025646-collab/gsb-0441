# Windows 本地 Bech32 / Bech32m 编解码后端

这是一个只包含 HTTP API 与 CLI 的 TypeScript + Node.js + SQLite 后端。它只处理 Bech32 与 Bech32m 字符串、五位数据字、八位字节转换、校验和核验、算例保存与导出；不生成私钥、不管理钱包、不广播交易，也不解读比特币见证版本。

## 核心规则

- 字符表固定为 `qpzry9x8gf2tvdw0s3jn54khce6mua7l`。
- 分隔符是最后一个数字 `1`，HRP 自身可以包含 `1`。
- HRP 非空，只允许 ASCII 33 到 126；正式校验前把全大写或全小写输入规范成小写。
- 输入总长不能超过 90；分隔符后至少有 6 个校验字符。
- 混合大小写、错误字符、错误 HRP、长度超限、损坏校验和均返回明确错误码，不做自动纠错。
- Bech32 最终余数常数为 `1`，Bech32m 为 `0x2bc830a3`。
- 校验状态始终按无符号 30 位处理，使用 `>>>` 避免 JavaScript 有符号 32 位位运算问题。

HRP 展开为：

1. 每个字符码右移 5 位；
2. 一个 `0`；
3. 每个字符码取低 5 位。

`polymod` 初值为 `1`，生成元为：

- `0x3b6a57b2`
- `0x26508e6d`
- `0x1ea119fa`
- `0x3d4233dd`
- `0x2a1462b3`

编码时在数据后追加 6 个零，计算余数后异或变体常数，再从高位到低位提取 6 个五位校验字。

## 五位组与字节模式

低层接口直接处理 `0..31` 的五位整数数组，空数组也是合法数据。

字节模式把 8 位字节流打包成五位组。最后不足一组时，编码允许补零。解码回字节时：

- 非零残余位：返回 `VALID_CHECKSUM_INVALID_BYTES`，内层错误为 `INVALID_PADDING_NONZERO`；
- 多出一整组五位填充：返回 `VALID_CHECKSUM_INVALID_BYTES`，内层错误为 `INVALID_PADDING_EXTRA_GROUP`。

因此，Bech32 校验和正确只证明字符串校验通过，不证明它一定是合法的字节流；API 不会悄悄丢弃尾部残余位。

## 环境要求

- Windows PowerShell
- Node.js 25（已在 `v25.5.0` 验证）
- npm

SQLite 使用 Node.js 内置 `node:sqlite`，数据文件默认位于项目内 `data/bech32-examples.sqlite`，不需要 Docker、WSL、外部数据库或在线服务。当前 Node 版本会提示 SQLite experimental warning，不影响本项目测试运行。

## 安装、构建与测试

```powershell
npm install
npm run build
npm test
```

启动生产构建：

```powershell
npm start
npm start -- --port 8080 --data-dir data
```

开发模式直接运行 TypeScript：

```powershell
npm run dev
npm run dev -- --port 8080
```

不传 `--port` 时自动选择一个本机空闲端口，监听地址固定为 `127.0.0.1`。

## CLI 示例

编码五位数据：

```powershell
npm run cli -- encode --hrp tb --data "[0,3,31,16]" --variant bech32m
```

编码十六进制字节，`--hex` 与 `--data` 互斥：

```powershell
npm run cli -- encode --hrp demo --hex 00ff --variant bech32m
```

解码并识别变体：

```powershell
npm run cli -- decode --input A1LQFN3A
```

指定预期 HRP、变体并按字节模式还原：

```powershell
npm run cli -- decode --input demo1qrlsh0r3dz --expect-hrp demo --expect-variant bech32m --mode bytes
```

查看 HRP 展开、逐步 polymod 状态和校验字：

```powershell
npm run cli -- explain --hrp a --data "[]" --variant bech32
```

字节往返：

```powershell
npm run cli -- roundtrip --hex 00ff --hrp demo --variant bech32m
```

保存算例。同名算例会新增 revision，不覆盖原输入、原大小写或错误字节诊断：

```powershell
npm run cli -- save --name demo --hrp demo --hex 00ff --variant bech32m --mode bytes
npm run cli -- history --name demo
npm run cli -- export --out data/export.json
```

运行内建失败路径和边界演示：

```powershell
npm run demo
```

## HTTP API

服务启动后可使用以下端点，请求与响应均为 JSON。

- `GET /health`：健康检查。
- `POST /api/encode`：编码。
- `POST /api/decode`：解码、变体识别、HRP 核验、字节还原。
- `POST /api/explain`：返回 HRP 展开、五位数组、逐步 polymod、六校验字和最终余数。
- `POST /api/roundtrip`：十六进制字节编码后再解码。
- `POST /api/examples`：保存算例。
- `GET /api/examples?name=demo`：查看历史。
- `GET /api/examples/demo`：查看指定算例最新版本。
- `GET /api/export`：导出全部算例 JSON。

编码请求：

```json
{
  "hrp": "demo",
  "hex": "00ff",
  "variant": "bech32m"
}
```

也可以传 `data: [0,3,31,16]`，但 `hex` 与 `data` 不能同时出现。

解码请求：

```json
{
  "input": "demo1qrlsh0r3dz",
  "expectedHrp": "demo",
  "expectedVariant": "bech32m",
  "mode": "bytes"
}
```

`mode` 省略时返回五位数据；设为 `bytes` 时同时返回字节和填充诊断。

## 错误码

- `INVALID_CASE`：混合大小写。
- `INVALID_LENGTH`：超过 90 字符或编码结果超限。
- `INVALID_HRP`：HRP 为空或字符不在 ASCII 33..126。
- `MISSING_SEPARATOR`：没有 `1` 分隔符。
- `INVALID_CHARACTER`：字符不在 Bech32 字符表或 JSON 请求无效。
- `CHECKSUM_TOO_SHORT`：分隔符后少于 6 个字符。
- `INVALID_CHECKSUM`：最终余数不属于两种变体，通常是字符损坏。
- `UNKNOWN_VARIANT`：检测变体与明确指定的预期变体不符，或请求的变体名未知。
- `HRP_MISMATCH`：预期 HRP 不一致，即使校验和正确也拒绝。
- `INVALID_FIVE_BIT_VALUE`：五位值不在 `0..31`，或字节值不在 `0..255`。
- `INVALID_HEX`：十六进制格式错误。
- `INPUT_CONFLICT`：同时提供互斥输入。
- `MISSING_INPUT`：缺少必填文本。
- `VALID_CHECKSUM_INVALID_BYTES`：Bech32 校验通过，但字节填充不合法。
- `NOT_FOUND`：历史算例不存在。

## 已验证场景

测试与演示覆盖：

- 标准空数据 `A12UEL5L` 与 `A1LQFN3A`，分别识别 Bech32 和 Bech32m；
- 全大写规范化到小写且数据含义不变，混合大小写拒绝；
- 任意短字节块 `00ff` 的编码、字节还原和十六进制往返；
- 翻转末字符导致 `INVALID_CHECKSUM`；
- 校验和正确但非零残余位被单独标记为字节填充无效；
- 多分隔符、空前缀、90/91 长度边界、零字节数据、空五位数组；
- 两个变体互不误认；
- HRP 不符即使校验正确也拒绝；
- SQLite 保存原始输入、规范化字符串、变体、五位数据与诊断；
- 同名修订另建版本，重启进程后仍可查询历史并导出。

## 范围限制

本项目不提供地址语义、钱包、网络交易、见证版本解释或自动纠错。调用方应根据自己的协议解释 HRP、五位数据以及字节模式填充是否适用。
