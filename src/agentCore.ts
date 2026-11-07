import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Message = Record<string, any>;

export type AgentEvent =
  | { type: "tool_call"; step: number; name: string; args: Message }
  | { type: "tool_result"; step: number; name: string; isError: boolean; text: string }
  | { type: "retry"; waitSeconds: number; attempt: number }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const MAX_STEPS = 10;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = [
  "You are a data analyst assistant for a Brazilian e-commerce marketplace (Olist).",
  "Answer questions by querying the PostgreSQL database with the tools provided.",
  "Workflow: 1) if the question involves a business metric, call get_metric_definitions first; 2) use list_tables and describe_table to understand the schema before writing SQL; 3) call run_query with a single SELECT statement; 4) if a query is blocked or fails, read the error, fix the SQL and try again.",
  "Never guess numbers. Every number in your answer must come from a query result.",
  "Prefer aggregated queries (GROUP BY, COUNT, AVG) over fetching raw rows. Results are capped at 100 rows.",
  "If the question is not about this database, politely say you can only answer questions about this e-commerce data.",
  "Answer concisely in plain English, and show the final SQL you used at the end.",
].join("\n");

async function callGroq(messages: Message[], tools: Message[], onEvent: (event: AgentEvent) => void): Promise<Message> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.GROQ_API_KEY,
      },
      body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto", temperature: 0 }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices[0].message;
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitSeconds = retryAfter > 0 ? retryAfter + 1 : 5 * 2 ** attempt;
      onEvent({ type: "retry", waitSeconds, attempt: attempt + 1 });
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    throw new Error("Groq API error " + res.status + ": " + (await res.text()));
  }
}

export async function createAgent() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/server.ts"],
    env: process.env as Record<string, string>,
  });
  const client = new Client({ name: "sql-agent", version: "0.1.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const llmTools = tools.map((tool) => {
    const { $schema, ...parameters } = tool.inputSchema as Message;
    return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
  });

  async function ask(question: string, onEvent: (event: AgentEvent) => void): Promise<void> {
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ];
    try {
      for (let step = 1; step <= MAX_STEPS; step++) {
        const reply = await callGroq(messages, llmTools, onEvent);

        if (!reply.tool_calls || reply.tool_calls.length === 0) {
          onEvent({ type: "answer", text: reply.content ?? "" });
          return;
        }

        messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });
for (const call of reply.tool_calls) {
          let args: Message = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            messages.push({ role: "tool", tool_call_id: call.id, content: "Error: tool arguments were not valid JSON." });
            continue;
          }
          onEvent({ type: "tool_call", step, name: call.function.name, args });
          const result = await client.callTool({ name: call.function.name, arguments: args });
          const text = (result.content as Message[]).map((c) => c.text ?? "").join("\n");
          onEvent({ type: "tool_result", step, name: call.function.name, isError: result.isError === true, text });
          messages.push({ role: "tool", tool_call_id: call.id, content: text });
        }
      }
      onEvent({ type: "error", message: "Stopped after " + MAX_STEPS + " steps without a final answer." });
    } catch (err) {
      onEvent({ type: "error", message: (err as Error).message });
    }
  }

  return { ask, close: () => client.close() };
}