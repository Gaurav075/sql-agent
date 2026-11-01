import pg from "pg";

const url = process.env.AGENT_DATABASE_URL;
if (!url) {
  throw new Error("AGENT_DATABASE_URL is not set");
}
export const pool = new pg.Pool({ connectionString: url });