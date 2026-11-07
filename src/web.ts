import express from "express";
import path from "node:path";
import rateLimit from "express-rate-limit";
import { createAgent } from "./agentCore.js";

const PORT = Number(process.env.PORT) || 3000;
const MAX_CONCURRENT = 2;
const QUESTIONS_PER_HOUR = 10;

const agent = await createAgent();
const app = express();
let active = 0;

// Hosts like Render sit behind a proxy; trust it so req.ip is the visitor's real IP
app.set("trust proxy", 1);
app.use(express.static(path.join(process.cwd(), "public")));

function startStream(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function send(res: express.Response, event: object) {
  res.write("data: " + JSON.stringify(event) + "\n\n");
}

function sendErrorAndClose(res: express.Response, message: string) {
  startStream(res);
  send(res, { type: "error", message });
  send(res, { type: "done" });
  res.end();
}

const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: QUESTIONS_PER_HOUR,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    sendErrorAndClose(res, "You have reached the limit of " + QUESTIONS_PER_HOUR + " questions per hour. Please try again later.");
  },
});

app.get("/api/ask", askLimiter, async (req, res) => {
  const question = String(req.query.q ?? "").trim();
  if (!question || question.length > 500) {
    sendErrorAndClose(res, "Question must be 1 to 500 characters.");
    return;
  }
  if (active >= MAX_CONCURRENT) {
    sendErrorAndClose(res, "The agent is busy answering other questions. Please try again in a minute.");
    return;
  }

  active++;
  try {
    startStream(res);
    await agent.ask(question, (event) => send(res, event));
    send(res, { type: "done" });
    res.end();
  } finally {
    active--;
  }
});

app.listen(PORT, () => {
  console.log("sql-agent web running at http://localhost:" + PORT);
});