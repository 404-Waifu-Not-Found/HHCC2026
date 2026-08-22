import { DatabaseSync, type StatementSync } from "node:sqlite";

export type BatchResult = { success: true; meta: { changes: number } };

export class SqliteD1Statement {
  constructor(
    private readonly adapter: SqliteD1Adapter,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.adapter, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    this.adapter.beforeFirst?.(this.sql);
    return (
      (this.statement().get(
        ...(this.params as Parameters<StatementSync["get"]>),
      ) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.statement().all(
        ...(this.params as Parameters<StatementSync["all"]>),
      ) as T[],
      success: true,
    };
  }

  async run(): Promise<BatchResult> {
    return this.runSync();
  }

  runSync(): BatchResult {
    const result = this.statement().run(
      ...(this.params as Parameters<StatementSync["run"]>),
    );
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private statement(): StatementSync {
    return this.adapter.sqlite.prepare(this.sql);
  }
}

export class SqliteD1Adapter {
  beforeFirst: ((sql: string) => void) | undefined;

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements: SqliteD1Statement[]): Promise<BatchResult[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createSqliteD1(): {
  sqlite: DatabaseSync;
  adapter: SqliteD1Adapter;
} {
  const sqlite = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  return { sqlite, adapter: new SqliteD1Adapter(sqlite) };
}
