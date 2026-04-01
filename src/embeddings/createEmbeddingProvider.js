import { CustomEmbeddingProvider } from "./customEmbeddingProvider.js";
import { GeminiEmbeddingProvider } from "./geminiEmbeddingProvider.js";

export function createEmbeddingProvider(config) {
  const providerName = config.provider;

  if (providerName === "gemini") {
    return new GeminiEmbeddingProvider({
      apiKey: config.apiKey,
      modelName: config.geminiModel,
    });
  }

  if (providerName === "custom") {
    return new CustomEmbeddingProvider({
      dimension: config.customDimension,
    });
  }

  throw new Error(
    `Unsupported embedding provider: ${providerName}. Supported providers are 'gemini' and 'custom'.`,
  );
}
