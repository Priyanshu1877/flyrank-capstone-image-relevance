import crypto from 'node:crypto';
import { IEmbeddingProvider, EmbeddingResult } from './types.js';

export type MockEmbeddingScenario =
  | 'default'
  | 'invalid_dimensions'
  | 'nan_values'
  | 'infinity_values'
  | 'timeout'
  | 'rate_limit'
  | 'server_error';

export interface MockEmbeddingOptions {
  scenario?: MockEmbeddingScenario;
  expectedDimensions?: number;
  latencyMs?: number;
}

export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly providerName = 'mock';
  readonly modelName = 'mock-text-embedding-004';
  readonly expectedDimensions: number;

  private currentScenario: MockEmbeddingScenario;
  private fixedLatencyMs: number;

  constructor(options: MockEmbeddingOptions = {}) {
    this.currentScenario = options.scenario ?? 'default';
    this.expectedDimensions = options.expectedDimensions ?? 768;
    this.fixedLatencyMs = options.latencyMs ?? 30;
  }

  setScenario(scenario: MockEmbeddingScenario): void {
    this.currentScenario = scenario;
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (this.fixedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.fixedLatencyMs, 20)));
    }

    if (this.currentScenario === 'timeout') {
      const err = new Error('AI Embedding request timed out after 30000ms');
      err.name = 'TimeoutError';
      throw err;
    }

    if (this.currentScenario === 'rate_limit') {
      const err = new Error('AI Provider rate limit exceeded (HTTP 429: RESOURCE_EXHAUSTED)');
      (err as unknown as { status: number }).status = 429;
      throw err;
    }

    if (this.currentScenario === 'server_error') {
      const err = new Error('AI Provider internal server error (HTTP 500)');
      (err as unknown as { status: number }).status = 500;
      throw err;
    }

    if (this.currentScenario === 'invalid_dimensions') {
      return {
        embedding: new Array(512).fill(0.1), // Wrong dimensions (512 instead of 768)
        dimensions: 512,
        inputTokens: Math.ceil(text.length / 4),
        latencyMs: this.fixedLatencyMs,
        estimatedCostUsd: 0.000005,
        model: this.modelName,
        provider: this.providerName
      };
    }

    if (this.currentScenario === 'nan_values') {
      const corrupted = new Array(this.expectedDimensions).fill(0.1);
      corrupted[0] = NaN;
      return {
        embedding: corrupted,
        dimensions: this.expectedDimensions,
        inputTokens: Math.ceil(text.length / 4),
        latencyMs: this.fixedLatencyMs,
        estimatedCostUsd: 0.000005,
        model: this.modelName,
        provider: this.providerName
      };
    }

    if (this.currentScenario === 'infinity_values') {
      const corrupted = new Array(this.expectedDimensions).fill(0.1);
      corrupted[0] = Infinity;
      return {
        embedding: corrupted,
        dimensions: this.expectedDimensions,
        inputTokens: Math.ceil(text.length / 4),
        latencyMs: this.fixedLatencyMs,
        estimatedCostUsd: 0.000005,
        model: this.modelName,
        provider: this.providerName
      };
    }

    // Default: Deterministic pseudo-random normalized vector derived from text content
    const vector = this.deriveDeterministicVector(text, this.expectedDimensions);

    return {
      embedding: vector,
      dimensions: this.expectedDimensions,
      inputTokens: Math.ceil(text.length / 4),
      latencyMs: this.fixedLatencyMs,
      estimatedCostUsd: 0.000005,
      model: this.modelName,
      provider: this.providerName
    };
  }

  /**
   * Generates a deterministic L2-normalized unit vector of length N.
   * Incorporates category and subject concept decomposition to simulate realistic semantic embeddings.
   */
  private deriveDeterministicVector(text: string, dimensions: number): number[] {
    const CATEGORIES = ['wildlife', 'culinary', 'technology', 'architecture'];
    const SUBJECTS = [
      'red fox',
      'fox',
      'gray wolf',
      'wolf',
      'brown bear',
      'bear',
      'river otter',
      'otter',
      'red deer',
      'deer',
      'bald eagle',
      'eagle',
      'siberian tiger',
      'tiger',
      'african lion',
      'lion',
      'barn owl',
      'owl',
      'giant panda',
      'panda',
      'plains zebra',
      'zebra',
      'african giraffe',
      'giraffe',
      'espresso',
      'coffee',
      'matcha',
      'tea',
      'sourdough',
      'bread',
      'pizza',
      'pasta',
      'salad',
      'sushi',
      'croissant',
      'burger',
      'smoothie',
      'apple pie',
      'ramen',
      'laptop',
      'server rack',
      'circuit board',
      'smartphone',
      'robotics',
      'quantum',
      'code',
      'drone',
      'cybersecurity',
      'vr headset',
      'fiber optics',
      '3d printer',
      'brutalist',
      'cathedral',
      'pagoda',
      'skyscraper',
      'bridge',
      'colosseum',
      'temple',
      'museum',
      'historic street',
      'riad',
      'terminal',
      'lighthouse'
    ];

    const lower = text.toLowerCase();
    const blended = new Array(dimensions).fill(0);
    let matchedConcept = false;

    // 1. Category vector component (word-boundary matched)
    for (const cat of CATEGORIES) {
      const catRegex = new RegExp(`\\b${cat}\\b`, 'i');
      if (catRegex.test(lower)) {
        const catVec = this.rawHashVector(`category:${cat}`, dimensions);
        for (let i = 0; i < dimensions; i++) {
          blended[i] += (catVec[i] ?? 0) * 0.45;
        }
        matchedConcept = true;
        break;
      }
    }

    // 2. Subject vector component (longest term matched with word boundary)
    const sortedSubjects = [...SUBJECTS].sort((a, b) => b.length - a.length);
    for (const sub of sortedSubjects) {
      const subRegex = new RegExp(`\\b${sub}(?:s|es)?\\b`, 'i');
      if (subRegex.test(lower)) {
        const subVec = this.rawHashVector(`subject:${sub}`, dimensions);
        for (let i = 0; i < dimensions; i++) {
          blended[i] += (subVec[i] ?? 0) * 0.5;
        }
        matchedConcept = true;
        break;
      }
    }

    // 3. Unique text residual noise
    const noiseVec = this.rawHashVector(`text:${text}`, dimensions);
    const noiseWeight = matchedConcept ? 0.05 : 1.0;
    for (let i = 0; i < dimensions; i++) {
      blended[i] += (noiseVec[i] ?? 0) * noiseWeight;
    }

    // 4. L2 normalization to unit vector
    let sumSq = 0;
    for (let i = 0; i < dimensions; i++) {
      const val = blended[i] ?? 0;
      sumSq += val * val;
    }
    const norm = Math.sqrt(sumSq) || 1.0;

    const result = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      const val = blended[i] ?? 0;
      result[i] = Number((val / norm).toFixed(6));
    }

    return result;
  }

  private rawHashVector(seed: string, dimensions: number): number[] {
    const vector: number[] = new Array(dimensions);
    let hash = crypto.createHash('sha256').update(seed).digest();

    for (let i = 0; i < dimensions; i++) {
      if (i % 32 === 0 && i > 0) {
        hash = crypto.createHash('sha256').update(hash).digest();
      }
      const byteVal = hash[i % 32] ?? 0;
      vector[i] = (byteVal - 128) / 128.0;
    }

    let sumSq = 0;
    for (let i = 0; i < dimensions; i++) {
      const val = vector[i] ?? 0;
      sumSq += val * val;
    }
    const norm = Math.sqrt(sumSq) || 1.0;

    for (let i = 0; i < dimensions; i++) {
      const val = vector[i] ?? 0;
      vector[i] = val / norm;
    }

    return vector;
  }
}
