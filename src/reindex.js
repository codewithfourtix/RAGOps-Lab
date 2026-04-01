import { RAGPipeline } from "./rag.js";

const rag = new RAGPipeline();
const inputPath = process.argv[2] ?? "knowledge.txt";

async function run() {
  console.log(`Reindexing source: ${inputPath}`);
  await rag.resetDocuments();
  await rag.ingest(inputPath);
  const total = await rag.countDocuments();
  console.log(`Reindex complete. Current rows: ${total}`);
}

run().catch((error) => {
  console.error("Reindex failed:", error.message);
  process.exitCode = 1;
});
