import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Bech32Error } from './errors';

export interface CaseRecord {
  id: number;
  version: number;
  original: string;      // 原输入（保留大小写）
  normalized: string;    // 小写规范化串
  variant: string;
  hrp: string;
  data: string;          // JSON 五位数组
  bytesHex: string | null;
  ok: number;            // 1 成功 / 0 失败
  errorCode: string | null;
  diagnostics: string;   // JSON 数组
  createdAt: string;
}

export class CaseStore {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath ?? path.join(dir, 'cases.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        original TEXT NOT NULL,
        normalized TEXT NOT NULL,
        variant TEXT NOT NULL,
        hrp TEXT NOT NULL,
        data TEXT NOT NULL,
        bytesHex TEXT,
        ok INTEGER NOT NULL,
        errorCode TEXT,
        diagnostics TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
  }

  /** 保存算例。同一 normalized 串再次保存时递增 version，不覆盖旧记录。 */
  save(rec: Omit<CaseRecord, 'id' | 'version' | 'createdAt'>): CaseRecord {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM cases WHERE normalized = ?')
      .get(rec.normalized) as { v: number };
    const version = row.v + 1;
    const createdAt = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO cases (version, original, normalized, variant, hrp, data, bytesHex, ok, errorCode, diagnostics, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version, rec.original, rec.normalized, rec.variant, rec.hrp, rec.data,
        rec.bytesHex, rec.ok, rec.errorCode, rec.diagnostics, createdAt,
      );
    return { id: Number(info.lastInsertRowid), version, createdAt, ...rec };
  }

  list(limit = 50): CaseRecord[] {
    return this.db
      .prepare('SELECT * FROM cases ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as CaseRecord[];
  }

  get(id: number): CaseRecord {
    const row = this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as unknown as
      | CaseRecord
      | undefined;
    if (!row) throw new Bech32Error('E_NOT_FOUND', `算例 ${id} 不存在`);
    return row;
  }

  close(): void {
    this.db.close();
  }
}
