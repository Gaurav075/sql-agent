import { createAgent } from "./agentCore.js";

async function main() {
  const question = process.argv.slice(2).join(" ");
  if (!question) {
    console.error("Usage: npx tsx --env-file=.env src/agent.ts \"your question\"");
    process.exit(1);
  }

  const agent = await createAgent();
  try {
    await agent.ask(question, (event) => {
      if (event.type === "tool_call") {
        console.log("[step " + event.step + "] " + event.name + " " + JSON.stringify(event.args));
      } else if (event.type === "retry") {
        console.log("[rate limited] waiting " + event.waitSeconds + "s, then retrying (" + event.attempt + "/3)");
      } else if (event.type === "answer") {
        console.log("\nAnswer:\n" + event.text);
      } else if (event.type === "error") {
        console.error("Error: " + event.message);
      }
    });
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});