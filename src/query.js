import { RAGPipeline } from "./rag.js";

const rag = new RAGPipeline();
const question =
  process.argv.slice(2).join(" ").trim() || "What is in the knowledge base?";

async function run() {
  await rag.query(question);
}

run().catch((error) => {
  console.error("Query failed:", error.message);
  process.exitCode = 1;
});
