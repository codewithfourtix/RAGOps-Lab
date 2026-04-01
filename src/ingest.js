import { RAGPipeline } from "./rag.js";

const rag = new RAGPipeline();
const inputPath = process.argv[2] ?? "knowledge.txt";

async function run() {
  await rag.ingest(inputPath);
}

run().catch((error) => {
  console.error("Ingestion failed:", error.message);
  process.exitCode = 1;
});
