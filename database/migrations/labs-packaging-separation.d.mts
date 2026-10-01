import type { InArgs } from "@libsql/core/api";

type MigrationDatabase = {
  execute: (statement: string | { sql: string; args?: InArgs }) => Promise<{ rows: Array<Record<string, unknown>> }>;
  transaction: (mode: "write") => Promise<{
    execute: (statement: string | { sql: string; args?: InArgs }) => Promise<{ rows: Array<Record<string, unknown>> }>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    close: () => void;
  }>;
};

export function migrateLabsPackagingSeparation(db: MigrationDatabase): Promise<boolean>;
