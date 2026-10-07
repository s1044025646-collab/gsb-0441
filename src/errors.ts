export type ErrorCode =
  | 'E_LENGTH'        // 总长度超过 90
  | 'E_CASE'          // 混合大小写
  | 'E_HRP_EMPTY'     // 空前缀
  | 'E_HRP_CHAR'      // 前缀含 ASCII 33..126 之外的字符
  | 'E_NO_SEPARATOR'  // 缺少分隔符 1
  | 'E_CHECKSUM_SHORT'// 分隔符后不足 6 个校验字
  | 'E_CHARSET'       // 数据/校验区含字符表外字符
  | 'E_CHECKSUM'      // 校验和不匹配
  | 'E_VARIANT'       // 未知或不匹配的变体
  | 'E_DATA_WORD'     // 五位字超出 0..31 或非整数
  | 'E_PADDING'       // 字节模式填充位不合规（非零残余位或整组多余填充）
  | 'E_INPUT'         // 输入参数互斥/缺失等通用参数错误
  | 'E_PREFIX_MISMATCH' // 预期前缀不符
  | 'E_NOT_FOUND';    // 持久化记录不存在

export class Bech32Error extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'Bech32Error';
  }
}
