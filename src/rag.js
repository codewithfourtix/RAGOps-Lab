import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import "dotenv/config";
import { createEmbeddingProvider } from "./embeddings/createEmbeddingProvider.js";

const DEFAULT_CONFIG = {
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "gemini",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "models/gemini-embedding-001",
  customEmbeddingDimension: Number(
    process.env.CUSTOM_EMBEDDING_DIMENSION ?? 768,
  ),
  chunkingStrategy: process.env.CHUNKING_STRATEGY ?? "line",
  generationModel: process.env.GENERATION_MODEL ?? "gemini-2.5-flash",
  matchCount: Number(process.env.MATCH_COUNT ?? 3),
  chunkSize: Number(process.env.CHUNK_SIZE ?? 1000),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 200),
};

function validateRequiredEnv(config) {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

  if (!process.env.GEMINI_API_KEY) {
    required.push("GEMINI_API_KEY");
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Update your .env file.`,
    );
  }

  const allowedProviders = ["gemini", "custom"];
  if (!allowedProviders.includes(config.embeddingProvider)) {
    throw new Error(
      `Invalid EMBEDDING_PROVIDER '${config.embeddingProvider}'. Use one of: ${allowedProviders.join(", ")}.`,
    );
  }

  const allowedChunkingStrategies = ["line", "character"];
  if (!allowedChunkingStrategies.includes(config.chunkingStrategy)) {
    throw new Error(
      `Invalid CHUNKING_STRATEGY '${config.chunkingStrategy}'. Use one of: ${allowedChunkingStrategies.join(", ")}.`,
    );
  }
}

export class RAGPipeline {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    validateRequiredEnv(this.config);

    if (this.config.chunkOverlap >= this.config.chunkSize) {
      throw new Error("chunkOverlap must be smaller than chunkSize");
    }

    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );

    this.embeddingProvider = createEmbeddingProvider({
      provider: this.config.embeddingProvider,
      apiKey: process.env.GEMINI_API_KEY,
      geminiModel: this.config.embeddingModel,
      customDimension: this.config.customEmbeddingDimension,
    });
  }

  loadDocument(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Document not found: ${filePath}`);
    }
    return readFileSync(filePath, "utf-8");
  }

  chunkTextByCharacters(
    text,
    chunkSize = this.config.chunkSize,
    overlap = this.config.chunkOverlap,
  ) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      const chunk = text.slice(i, i + chunkSize);
      chunks.push(chunk);
      i += chunkSize - overlap;
    }
    return chunks.filter((c) => c.trim() !== "");
  }

  chunkTextByLines(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  chunkText(text) {
    if (this.config.chunkingStrategy === "line") {
      return this.chunkTextByLines(text);
    }

    return this.chunkTextByCharacters(text);
  }

  async embedText(text) {
    return this.embeddingProvider.embed(text);
  }

  createChunkId(source, content) {
    return createHash("sha256").update(`${source}::${content}`).digest("hex");
  }

  async resetDocuments() {
    const { error } = await this.supabase
      .from("documents")
      .delete()
      .not("id", "is", null);

    if (error) {
      throw new Error(`Failed to reset documents table: ${error.message}`);
    }
  }

  async countDocuments() {
    const { count, error } = await this.supabase
      .from("documents")
      .select("*", { count: "exact", head: true });

    if (error) {
      throw new Error(`Failed to count documents: ${error.message}`);
    }

    return count ?? 0;
  }

  async saveToSupabase(content, embedding, metadata) {
    const { data: existingRows, error: existingError } = await this.supabase
      .from("documents")
      .select("id")
      .contains("metadata", { chunk_id: metadata.chunk_id })
      .limit(1);

    if (existingError) {
      throw new Error(
        `Failed to check existing chunk in Supabase: ${existingError.message}`,
      );
    }

    if ((existingRows ?? []).length > 0) {
      const documentId = existingRows[0].id;
      const { error: updateError } = await this.supabase
        .from("documents")
        .update({ content, embedding, metadata })
        .eq("id", documentId);

      if (updateError) {
        throw new Error(
          `Failed to update chunk in Supabase: ${updateError.message}`,
        );
      }

      console.log(
        "Updated chunk:",
        content.slice(0, 60).replace(/\n/g, " ") + "...",
      );
      return;
    }

    const { error } = await this.supabase.from("documents").insert({
      content,
      embedding,
      metadata,
    });

    if (error) {
      throw new Error(`Failed to save chunk in Supabase: ${error.message}`);
    }

    console.log(
      "Saved chunk:",
      content.slice(0, 60).replace(/\n/g, " ") + "...",
    );
  }

  async ingest(filePath) {
    console.log("Starting ingestion...");
    const text = this.loadDocument(filePath);
    console.log("Document loaded!");

    const chunks = this.chunkText(text);
    console.log(`Split into ${chunks.length} chunks`);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const chunkId = this.createChunkId(filePath, chunk);
      const embedding = await this.embedText(chunk);
      await this.saveToSupabase(chunk, embedding, {
        source: filePath,
        chunk_index: index,
        chunk_id: chunkId,
      });
    }

    console.log("Ingestion complete!");
  }

  async findRelevantChunks(questionEmbedding) {
    const { data, error } = await this.supabase.rpc("match_documents", {
      query_embedding: questionEmbedding,
      match_count: this.config.matchCount,
    });

    if (error) {
      throw new Error(
        `Search failed in Supabase RPC match_documents: ${error.message}`,
      );
    }

    return data ?? [];
  }

  buildPrompt(question, chunks) {
    const context = chunks
      .map((chunk, index) => `${index + 1}. ${chunk.content}`)
      .join("\n");

    return `
You are a helpful assistant. Answer the question using ONLY the context provided below.
If the answer is not in the context, say "I don't have that information."

Context:
${context}

Question: ${question}

Answer:
    `.trim();
  }

  async generateAnswer(prompt) {
    const model = this.genAI.getGenerativeModel({
      model: this.config.generationModel,
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async query(question) {
    console.log("\nQuestion:", question);
    console.log("Searching for relevant chunks...");

    const questionEmbedding = await this.embedText(question);
    const chunks = await this.findRelevantChunks(questionEmbedding);

    if (chunks.length === 0) {
      const noContextAnswer = "I don't have that information.";
      console.log("No relevant chunks found.");
      console.log("\nAnswer:", noContextAnswer);
      return noContextAnswer;
    }

    console.log(`Found ${chunks.length} relevant chunks:`);
    chunks.forEach((chunk) => {
      console.log(
        `  - [similarity: ${chunk.similarity.toFixed(3)}] ${chunk.content.slice(0, 60).replace(/\n/g, " ")}...`,
      );
    });

    const prompt = this.buildPrompt(question, chunks);

    console.log("\nGenerating answer...");
    const answer = await this.generateAnswer(prompt);

    console.log("\nAnswer:", answer);
    return answer;
  }
}
