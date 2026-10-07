# Bech32 / Bech32m 双变体编解码与填充位核验后端

纯离线、本地运行的 TypeScript + Node.js + SQLite 后端，只做 Bech32 编码格式本身：
不生成私钥、不管理钱包、不广播交易，也不解释比特币见证版本。
核心（HRP 展开与 polymod）为自行实现，未调用任何现成 Bech32 库。

## 环境要求

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，无需原生编译、Docker、WSL 或任何在线服务）
- 首次使用执行 `npm install`（仅安装 TypeScript 开发依赖）

## 常用命令

```powershell
npm install        # 安装开发依赖（typescript、@types/node）
npm run build      # 编译到 dist/
npm test           # 编译并运行全部测试（node:test）
npm start          # 启动 HTTP API（默认自动选择空闲端口，PORT=8080 可指定）
npm run cli -- ... # CLI 入口
npm run demo       # 演示脚本（标准向量 / 往返 / 翻位失败 / 填充拒绝）
```

数据目录为项目内 `data/`，数据库文件 `data/cases.db`（可用环境变量 `BECH32_DB` 覆盖）。

## 核心概念

### 五位组模式 vs 字节模式

- **低层（五位组）模式**：数据是 0..31 的整数数组，允许空数组。编码直接拼接
  `HRP + '1' + 数据字 + 6 个校验字`。这是 Bech32 格式本身的定义层。
- **字节模式**：先把 8 位字节流按高位先行切成 5 位组（`convertBits 8->5`，末尾补零），
  再走五位组编码。解码时反向 `5->8` 转换**不允许非零残余位**，也**不接受一整组多余的填充**。
- 因此可能出现"Bech32 校验和正确但字节模式无效"的情况：此时低层 `decode` 通过，
  而 `decodeBytes` 单独抛出 `E_PADDING`，尾部位不会被悄悄丢弃。

### 六位校验和与 polymod

- HRP 展开 = 每个字符码 `>> 5` 的序列 + 一个 `0` + 每个字符码 `& 31` 的序列。
- polymod 初值为 1，生成元为标准的五项
  `0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3`。
- JavaScript 位运算是 32 位有符号，实现中每步与 `0x3fffffff` 相与，
  校验状态始终保持 30 位无符号，最高 5 位用 `>>> 25` 取出。
- 编码时在数据后补 6 个零字计算 polymod，再异或变体常数
  （Bech32 = `1`，Bech32m = `0x2bc830a3`），拆成 6 个五位校验字。
- 解码时 polymod 终值等于哪个常数即识别为哪个变体；两变体不会互相误认。
- **校验和只保证"串未被改动"，不保证字节填充合规，也不提供自动纠错**：
  任何字符被改动都会被拒绝并报告错误码，本服务不会尝试修复错误字符串。

### 输入规则

- 总长度 ≤ 90；HRP 非空且只含 ASCII 33..126；分隔符是**最后一个** `1`（HRP 自身可含 `1`）。
- 分隔符之后至少 6 个校验字；字符表固定为 `qpzry9x8gf2tvdw0s3jn54khce6mua7l`。
- 全大写或全小写均可，混合大小写拒绝（`E_CASE`）；统一按小写计算，编码输出小写。
- 规范化只改变大小写，不改变数据含义；原始输入的大小写会原样保存。

## HTTP API

默认端口为空闲端口（启动日志打印实际端口），`PORT` 环境变量可指定。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/encode` | `{hrp, words:[...]}` 或 `{hrp, hex:"..."}`（互斥），可选 `variant` |
| POST | `/decode` | `{input, expectedHrp?, byteMode?}`，识别变体并返回诊断 |
| POST | `/verify` | `{input, expectedHrp}` 指定前缀核验 |
| POST | `/explain` | 返回 HRP 展开与 polymod 每步状态 |
| POST | `/roundtrip` | `{hrp, hex, variant?}` 字节编码→解码往返 |
| POST | `/cases` | `{input, byteMode?}` 保存算例（同串重复保存自动升版本） |
| GET | `/cases?limit=n` | 最近算例列表 |
| GET | `/cases/:id` | 单条算例 |
| GET | `/export` | 导出全部算例 JSON |

错误响应形如 `{ok:false, errorCode:"E_CHECKSUM", message:"..."}`。

## CLI

```powershell
node dist/cli.js encode <hrp> <hex字节|w0,w1,...> [bech32|bech32m]
node dist/cli.js decode <字符串> [--hrp 预期前缀] [--bytes]
node dist/cli.js verify <字符串> --hrp 预期前缀
node dist/cli.js explain <字符串>        # HRP 展开 + polymod 逐步状态
node dist/cli.js roundtrip <hrp> <hex> [variant]
node dist/cli.js save <字符串> [--bytes]  # 失败算例也会落库（含错误码）
node dist/cli.js list [n]                 # 重启后仍可复核历史
node dist/cli.js export
```

CLI 解码展示：原串、规范串、变体、前缀、五位数据、校验字与诊断。

## 错误码

| 代码 | 含义 |
| --- | --- |
| `E_LENGTH` | 总长度超过 90 |
| `E_CASE` | 混合大小写 |
| `E_HRP_EMPTY` / `E_HRP_CHAR` | 空前缀 / 前缀字符越界 |
| `E_NO_SEPARATOR` / `E_CHECKSUM_SHORT` | 缺少分隔符 / 校验字不足 6 个 |
| `E_CHARSET` | 字符表外字符 |
| `E_CHECKSUM` | 校验和失败（两变体常数均不匹配） |
| `E_VARIANT` | 未知变体 |
| `E_DATA_WORD` | 五位字越界 |
| `E_PADDING` | 字节模式填充不合规（非零残余位 / 整组多余填充） |
| `E_PREFIX_MISMATCH` | 预期前缀不符（校验和本身有效也拒绝） |
| `E_INPUT` / `E_NOT_FOUND` | 参数互斥或缺失 / 记录不存在 |

## 持久化

SQLite 表 `cases` 保存：原输入（保留大小写）、规范化串、变体、HRP、五位数据、
字节 hex、成功标志、错误码、诊断与时间戳。同一规范化串再次保存会**另建版本**
（version 递增），不会覆盖历史记录中的原始大小写或错误字节，重启后可复核。

## 测试与验证

`npm test` 覆盖：BIP-173 / BIP-350 官方有效向量（polymod 的独立外部证据，
不依赖往返自证）、两变体互不误认、末位翻转、多分隔符、混合大小写、空前缀、
90 字符最长边界、零字节数据、填充位两类违规、前缀不符拒绝、SQLite 版本化与重开复核。

## 范围与限制

- 仅实现 Bech32/Bech32m 编码格式；不解释见证版本、不派生地址、不触网。
- 不提供自动纠错：校验失败即拒绝并给出错误码。
- 校验和正确 ≠ 字节填充正确，两者在 API 中是明确区分的两类结果。
- `node:sqlite` 在 Node 25 仍为实验特性（启动时有 ExperimentalWarning），功能可用。
