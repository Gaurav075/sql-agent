import pg from "pg";

const url = process.env.LOGGER_DATABASE_URL;
if (!url) {
  throw new Error("LOGGER_DATABASE_URL is not set");
}
const logPool = new pg.Pool({ connectionString: url, max: 2 });

export type AuditEntry = {
  tool: string;
  sql: string | null;
  status: "ok" | "blocked" | "error";
  errorMessage?: string;
  rowCount?: number;
  durationMs: number;
};

export async function logQuery(entry: AuditEntry): Promise<void> {
  try {
    await logPool.query(
      "INSERT INTO ops.audit_log (tool, sql_text, status, error_message, row_count, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)",
      [entry.tool, entry.sql, entry.status, entry.errorMessage ?? null, entry.rowCount ?? null, entry.durationMs]
    );
  } catch (err) {
    console.error("Audit log failed:", (err as Error).message);
  }
}