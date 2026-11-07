import express from "express";
import path from "node:path";
import { createAgent } from "./agentCore.js";

const PORT = Number(process.env.PORT) || 3000;
const agent = await createAgent();
const app = express();

app.use(express.static(path.join(process.cwd(), "public")));

app.get("/api/ask", async (req, res) => {
  const question = String(req.query.q ?? "").trim();
  if (!question || question.length > 500) {
    res.status(400).json({ error: "Question must be 1 to 500 characters." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  await agent.ask(question, (event) => {
    res.write("data: " + JSON.stringify(event) + "\n\n");
  });
  res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
  res.end();
});

app.listen(PORT, () => {
  console.log("sql-agent web running at http://localhost:" + PORT);
});