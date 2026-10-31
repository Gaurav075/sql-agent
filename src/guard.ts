import pkg from "node-sql-parser";
const { Parser } = pkg;
const parser = new Parser();

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

export function validateSql(input: string): GuardResult {
  const sql = input.trim().replace(/;+\s*$/, "");
  let ast;
  try {
    ast = parser.astify(sql, { database: "PostgresQL" });
  } catch (err) {
    return { ok: false, reason: `Could not parse SQL: ${(err as Error).message}` };
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    return { ok: false, reason: "Only one statement is allowed." };
  }
  if (statements[0].type !== "select") {
    return { ok: false, reason: `Only SELECT queries are allowed (got ${statements[0].type.toUpperCase()}).` };
  }
  return { ok: true, sql };
}