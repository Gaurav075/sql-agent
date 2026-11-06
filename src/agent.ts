import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Message = Record<string, any>;

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_STEPS = 10;

const SYSTEM_PROMPT = [
  "You are a data analyst assistant for a Brazilian e-commerce marketplace (Olist).",
  "Answer questions by querying the PostgreSQL database with the tools provided.",
  "Workflow: 1) if the question involves a business metric, call get_metric_definitions first; 2) use list_tables and describe_table to understand the schema before writing SQL; 3) call run_query with a single SELECT statement; 4) if a query is blocked or fails, read the error, fix the SQL and try again.",
  "Never guess numbers. Every number in your answer must come from a query result.",
  "Prefer aggregated queries (GROUP BY, COUNT, AVG) over fetching raw rows. Results are capped at 100 rows.",
  "If the question is not about this database, politely say you can only answer questions about this e-commerce data.",
  "Answer concisely in plain English, and show the final SQL you used at the end.",
].join("\n");

async function callGroq(messages: Message[], tools: Message[]): Promise<Message> {
  const MAX_RETRIES = 3;
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
      console.log("[rate limited] waiting " + waitSeconds + "s, then retrying (" + (attempt + 1) + "/" + MAX_RETRIES + ")");
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    throw new Error("Groq API error " + res.status + ": " + (await res.text()));
  }
}

async function main() {
  const question = process.argv.slice(2).join(" ");
  if (!question) {
    console.error("Usage: npx tsx --env-file=.env src/agent.ts \"your question\"");
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }

  // Start the MCP server as a child process and connect to it
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/server.ts"],
    env: process.env as Record<string, string>,
  });
  const client = new Client({ name: "sql-agent-cli", version: "0.1.0" });
  await client.connect(transport);

  try {
    // Convert MCP tool definitions into the format the LLM API expects
    const { tools } = await client.listTools();
    const llmTools = tools.map((tool) => {
      const { $schema, ...parameters } = tool.inputSchema as Message;
      return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
    });

    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    for (let step = 1; step <= MAX_STEPS; step++) {
      const reply = await callGroq(messages, llmTools);

      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        console.log("\nAnswer:\n" + reply.content);
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
        console.log("[step " + step + "] " + call.function.name + " " + JSON.stringify(args));
        const result = await client.callTool({ name: call.function.name, arguments: args });
        const text = (result.content as Message[]).map((c) => c.text ?? "").join("\n");
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
    console.log("Stopped: reached the maximum of " + MAX_STEPS + " steps without a final answer.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});