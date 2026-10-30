import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

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

await server.connect(new StdioServerTransport());
console.error("sql-agent MCP server running");