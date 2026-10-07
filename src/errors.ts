export type ErrorCode =
  | 'INVALID_CASE'
  | 'INVALID_LENGTH'
  | 'INVALID_HRP'
  | 'MISSING_SEPARATOR'
  | 'INVALID_CHARACTER'
  | 'CHECKSUM_TOO_SHORT'
  | 'UNKNOWN_VARIANT'
  | 'INVALID_CHECKSUM'
  | 'HRP_MISMATCH'
  | 'INVALID_FIVE_BIT_VALUE'
  | 'INVALID_HEX'
  | 'INPUT_CONFLICT'
  | 'MISSING_INPUT'
  | 'INVALID_PADDING_NONZERO'
  | 'INVALID_PADDING_EXTRA_GROUP'
  | 'VALID_CHECKSUM_INVALID_BYTES'
  | 'NOT_FOUND';

export class BechError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'BechError';
    this.code = code;
    this.details = details;
  }
}
