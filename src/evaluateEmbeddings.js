import { RAGPipeline } from "./rag.js";

const inputPath = process.argv[2] ?? "knowledge.txt";

const EVAL_SET = [
  {
    query: "where was messi born",
    expectedTerms: ["rosario", "argentina"],
  },
  {
    query: "how many goals has messi scored",
    expectedTerms: ["over 800", "career goals"],
  },
  {
    query: "how many ballon d'or awards did messi win",
    expectedTerms: ["8 times", "ballon d'or"],
  },
  {
    query: "which club did messi join in 2023",
    expectedTerms: ["inter miami", "2023"],
  },
  {
    query: "which world cup did messi win",
    expectedTerms: ["2022", "qatar"],
  },
];

function isRelevant(chunkContent, expectedTerms) {
  const normalized = chunkContent.toLowerCase();
  return expectedTerms.some((term) => normalized.includes(term));
}

async function evaluateProvider(providerName) {
  const rag = new RAGPipeline({ embeddingProvider: providerName });

  console.log(`\nEvaluating provider: ${providerName}`);
  await rag.resetDocuments();
  await rag.ingest(inputPath);

  let hitCount = 0;
  let reciprocalRankTotal = 0;

  for (const item of EVAL_SET) {
    const queryEmbedding = await rag.embedText(item.query);
    const chunks = await rag.findRelevantChunks(queryEmbedding);

    let firstRelevantRank = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      if (isRelevant(chunks[i].content ?? "", item.expectedTerms)) {
        firstRelevantRank = i + 1;
        break;
      }
    }

    const recallHit = firstRelevantRank > 0;
    hitCount += recallHit ? 1 : 0;
    reciprocalRankTotal += recallHit ? 1 / firstRelevantRank : 0;

    const rankLabel = recallHit ? `${firstRelevantRank}` : "-";
    console.log(
      `  query='${item.query}' hit=${recallHit ? "yes" : "no"} firstRelevantRank=${rankLabel}`,
    );
  }

  const queryCount = EVAL_SET.length;
  const recallAtK = hitCount / queryCount;
  const mrr = reciprocalRankTotal / queryCount;

  return {
    provider: providerName,
    recallAtK,
    mrr,
  };
}

async function run() {
  console.log(`Running embedding evaluation on: ${inputPath}`);
  const providers = ["gemini", "custom"];
  const results = [];

  for (const provider of providers) {
    const metrics = await evaluateProvider(provider);
    results.push(metrics);
  }

  console.log("\n=== Evaluation Summary (Recall@k, MRR) ===");
  console.log("provider | recall@k | mrr");
  console.log("---------|----------|-----");
  for (const result of results) {
    console.log(
      `${result.provider.padEnd(8)} | ${result.recallAtK.toFixed(3)}    | ${result.mrr.toFixed(3)}`,
    );
  }

  console.log("\nNote: Evaluation reindexes the documents table per provider.");
}

run().catch((error) => {
  console.error("Evaluation failed:", error.message);
  process.exitCode = 1;
});
