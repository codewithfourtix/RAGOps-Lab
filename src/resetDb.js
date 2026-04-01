import { RAGPipeline } from "./rag.js";

const rag = new RAGPipeline();

async function run() {
  console.log("Resetting documents table...");
  await rag.resetDocuments();
  const remaining = await rag.countDocuments();
  console.log(`Reset complete. Remaining rows: ${remaining}`);
}

run().catch((error) => {
  console.error("Reset failed:", error.message);
  process.exitCode = 1;
});
