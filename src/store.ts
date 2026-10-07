import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type SaveExample = {
  name: string;
  kind: string;
  originalInput: unknown;
  normalizedString: string | null;
  variant: string | null;
  data: number[] | null;
  diagnostics: unknown;
};

export class ExampleStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      create table if not exists examples (
        id integer primary key autoincrement,
        name text not null,
        revision integer not null,
        kind text not null,
        original_input text not null,
        normalized_string text,
        variant text,
        data text,
        diagnostics text not null,
        created_at text not null default (datetime('now')),
        unique(name, revision)
      );
    `);
  }

  save(example: SaveExample) {
    const revision = this.nextRevision(example.name);
    const result = this.db.prepare(`
      insert into examples
        (name, revision, kind, original_input, normalized_string, variant, data, diagnostics)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      example.name,
      revision,
      example.kind,
      JSON.stringify(example.originalInput),
      example.normalizedString,
      example.variant,
      example.data === null ? null : JSON.stringify(example.data),
      JSON.stringify(example.diagnostics),
    );
    return { id: Number(result.lastInsertRowid), name: example.name, revision };
  }

  private nextRevision(name: string): number {
    const row = this.db.prepare('select coalesce(max(revision), 0) + 1 as revision from examples where name = ?').get(name) as
      | { revision: number }
      | undefined;
    return row?.revision ?? 1;
  }

  history(name?: string) {
    const rows = name
      ? this.db.prepare('select * from examples where name = ? order by name, revision').all(name)
      : this.db.prepare('select * from examples order by name, revision').all();
    return rows.map(parseRow);
  }

  latest(name: string) {
    const row = this.db.prepare('select * from examples where name = ? order by revision desc limit 1').get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? parseRow(row) : null;
  }

  exportJson() {
    return this.history();
  }

  close() {
    this.db.close();
  }
}

function parseRow(row: unknown) {
  const source = row as Record<string, unknown>;
  return {
    ...source,
    id: Number(source.id),
    revision: Number(source.revision),
    originalInput: JSON.parse(String(source.original_input)),
    data: source.data === null ? null : JSON.parse(String(source.data)),
    diagnostics: JSON.parse(String(source.diagnostics)),
  };
}
