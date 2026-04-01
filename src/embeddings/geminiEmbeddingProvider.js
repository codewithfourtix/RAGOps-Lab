import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiEmbeddingProvider {
  constructor(config = {}) {
    this.modelName = config.modelName ?? "models/gemini-embedding-001";
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  async embed(text) {
    const model = this.client.getGenerativeModel({ model: this.modelName });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }
}
