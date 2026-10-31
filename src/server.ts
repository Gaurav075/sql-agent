import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";
import { validateSql } from "./guard.js";

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
  { description: "Get columns and types of a table", inputSchema: { table: z.string() } },
  async ({ table }) => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`, [table]);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  });
const MAX_ROWS = 100;

server.registerTool("run_query",
  {
    description: "Run a read-only SQL SELECT query on the PostgreSQL database. Returns at most 100 rows.",
    inputSchema: { sql: z.string().describe("A single PostgreSQL SELECT statement") },
  },
  async ({ sql }) => {
    const check = validateSql(sql);
    if (!check.ok) {
      return { isError: true, content: [{ type: "text", text: `Query blocked: ${check.reason}` }] };
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await client.query(
        `SELECT * FROM (${check.sql}) AS q LIMIT ${MAX_ROWS + 1}`);
      await client.query("ROLLBACK");
      const truncated = result.rows.length > MAX_ROWS;
      const rows = result.rows.slice(0, MAX_ROWS);
      return { content: [{ type: "text", text: JSON.stringify({ rowCount: rows.length, truncated, rows }) }] };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      return { isError: true, content: [{ type: "text", text: `Query failed: ${(err as Error).message}` }] };
    } finally {
      client.release();
    }
  });
await server.connect(new StdioServerTransport());
console.error("sql-agent MCP server running");