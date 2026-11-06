import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";
import { validateSql } from "./guard.js";
import { logQuery } from "./audit.js";
import { RULES, METRICS } from "./metrics.js";

const server = new McpServer({ name: "sql-agent", version: "0.1.0" });

server.registerTool("list_tables",
  { description: "List all tables in the database", inputSchema: {} },
  async () => {
    try {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
      return { content: [{ type: "text", text: JSON.stringify(rows.map(r => r.table_name)) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `DB error: ${(err as Error).message}` }] };
    }
  });

server.registerTool("describe_table",
  {
    description: "Describe a table: columns and types, primary key, foreign keys (how it joins to other tables), and approximate row count.",
    inputSchema: { table: z.string().describe("Table name, as returned by list_tables") },
  },
  async ({ table }) => {
    const start = Date.now();
    try {
      const columns = await pool.query(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
        [table]);
      if (columns.rows.length === 0) {
        await logQuery({ tool: "describe_table", sql: table, status: "error", errorMessage: "table not found", durationMs: Date.now() - start });
        return { isError: true, content: [{ type: "text", text: "Table '" + table + "' not found. Call list_tables to see the available tables." }] };
      }
      const keys = await pool.query(
        "SELECT pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con " +
        "JOIN pg_class rel ON rel.oid = con.conrelid " +
        "JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace " +
        "WHERE nsp.nspname = 'public' AND rel.relname = $1 AND con.contype IN ('p', 'f')",
        [table]);
      const size = await pool.query(
        "SELECT c.reltuples::bigint AS approx_rows FROM pg_class c " +
        "JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'public' AND c.relname = $1",
        [table]);
      const result = {
        table,
        approxRows: Number(size.rows[0]?.approx_rows ?? -1),
        columns: columns.rows.map(r => ({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES" })),
        keys: keys.rows.map(r => r.definition),
      };
      await logQuery({ tool: "describe_table", sql: table, status: "ok", rowCount: columns.rows.length, durationMs: Date.now() - start });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      const message = (err as Error).message;
      await logQuery({ tool: "describe_table", sql: table, status: "error", errorMessage: message, durationMs: Date.now() - start });
      return { isError: true, content: [{ type: "text", text: "describe_table failed: " + message }] };
    }
  });
const MAX_ROWS = 100;

server.registerTool("run_query",
  {
    description: "Run a read-only SQL SELECT query on the PostgreSQL database. Returns at most 100 rows.",
    inputSchema: { sql: z.string().describe("A single PostgreSQL SELECT statement") },
  },
  async ({ sql }) => {
    const start = Date.now();
    const check = validateSql(sql);
    if (!check.ok) {
      await logQuery({ tool: "run_query", sql, status: "blocked", errorMessage: check.reason, durationMs: Date.now() - start });
      return { isError: true, content: [{ type: "text", text: "Query blocked: " + check.reason }] };
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await client.query(
        "SELECT * FROM (" + check.sql + ") AS q LIMIT " + (MAX_ROWS + 1));
      await client.query("ROLLBACK");
      const truncated = result.rows.length > MAX_ROWS;
      const rows = result.rows.slice(0, MAX_ROWS);
      await logQuery({ tool: "run_query", sql, status: "ok", rowCount: rows.length, durationMs: Date.now() - start });
      return { content: [{ type: "text", text: JSON.stringify({ rowCount: rows.length, truncated, rows }) }] };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const message = (err as Error).message;
      await logQuery({ tool: "run_query", sql, status: "error", errorMessage: message, durationMs: Date.now() - start });
      return { isError: true, content: [{ type: "text", text: "Query failed: " + message }] };
    } finally {
      client.release();
    }
  });
  server.registerTool("get_metric_definitions",
  {
    description: "Get the official business definitions for metrics such as revenue, average order value, delivery time, late delivery rate, review score and unique customers, plus important data rules. ALWAYS call this before writing SQL that computes a business metric, and use these exact formulas and filters.",
    inputSchema: {},
  },
  async () => {
    await logQuery({ tool: "get_metric_definitions", sql: null, status: "ok", rowCount: METRICS.length, durationMs: 0 });
    return { content: [{ type: "text", text: JSON.stringify({ rules: RULES, metrics: METRICS }) }] };
  });
await server.connect(new StdioServerTransport());
console.error("sql-agent MCP server running");