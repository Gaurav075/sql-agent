import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Parents first, so foreign keys always find their rows
const files: [string, string][] = [
  ["customers", "olist_customers_dataset.csv"],
  ["sellers", "olist_sellers_dataset.csv"],
  ["products", "olist_products_dataset.csv"],
  ["category_translation", "product_category_name_translation.csv"],
  ["orders", "olist_orders_dataset.csv"],
  ["order_items", "olist_order_items_dataset.csv"],
  ["order_payments", "olist_order_payments_dataset.csv"],
  ["order_reviews", "olist_order_reviews_dataset.csv"],
];

for (const [table, file] of files) {
  const client = await pool.connect();
  try {
    const start = Date.now();
    console.log(`Loading ${table}...`);
    const copyStream = client.query(
      copyFrom(`COPY ${table} FROM STDIN WITH (FORMAT csv, HEADER true)`));
    await pipeline(fs.createReadStream(`data/${file}`), copyStream);
    const { rows } = await client.query(`SELECT COUNT(*) FROM ${table}`);
    console.log( ` ${rows[0].count} rows in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } finally {
    client.release();
  }
}
await pool.end();
console.log("All tables loaded.");