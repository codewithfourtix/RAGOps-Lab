function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildFeatures(tokens) {
  const features = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const unigram = tokens[i];
    features.push(`u:${unigram}`);

    if (i < tokens.length - 1) {
      features.push(`b:${unigram}_${tokens[i + 1]}`);
    }

    if (unigram.length >= 3) {
      for (let j = 0; j <= unigram.length - 3; j += 1) {
        features.push(`c3:${unigram.slice(j, j + 3)}`);
      }
    }
  }

  return features;
}

function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

export class CustomEmbeddingProvider {
  constructor(config = {}) {
    this.dimension = config.dimension ?? 768;
    this.hashCount = config.hashCount ?? 4;

    if (!Number.isInteger(this.dimension) || this.dimension <= 0) {
      throw new Error("Custom embedding dimension must be a positive integer");
    }

    if (!Number.isInteger(this.hashCount) || this.hashCount <= 0) {
      throw new Error("Custom embedding hashCount must be a positive integer");
    }
  }

  async embed(text) {
    const tokens = tokenize(text);
    const vector = new Array(this.dimension).fill(0);

    if (tokens.length === 0) {
      return vector;
    }

    const features = buildFeatures(tokens);
    const frequencies = new Map();
    for (const feature of features) {
      frequencies.set(feature, (frequencies.get(feature) ?? 0) + 1);
    }

    const featureCount = Math.max(features.length, 1);

    for (const [feature, count] of frequencies.entries()) {
      const tf = count / featureCount;

      for (let h = 0; h < this.hashCount; h += 1) {
        const salted = `${feature}:h${h}`;
        const index = fnv1a32(salted) % this.dimension;
        const signedWeight = (fnv1a32(`${salted}:sign`) & 1) === 0 ? 1 : -1;
        vector[index] += tf * signedWeight;
      }
    }

    return l2Normalize(vector);
  }
}
