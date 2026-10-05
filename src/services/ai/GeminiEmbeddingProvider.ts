import { IEmbeddingProvider, EmbeddingResult } from './types.js';

export interface GeminiEmbeddingOptions {
  apiKey?: string;
  modelName?: string;
  expectedDimensions?: number;
  timeoutMs?: number;
}

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly providerName = 'gemini';
  readonly modelName: string;
  readonly expectedDimensions: number;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiEmbeddingOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.modelName =
      options.modelName ?? process.env.GEMINI_EMBEDDING_MODEL ?? 'text-embedding-004';
    this.expectedDimensions = options.expectedDimensions ?? 768;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.apiKey || this.apiKey.trim() === '' || this.apiKey === 'mock-dev-key') {
      throw new Error(
        'Gemini Embedding provider cannot execute: Missing or unconfigured GEMINI_API_KEY.'
      );
    }

    const startTime = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:embedContent?key=${encodeURIComponent(
      this.apiKey
    )}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.modelName}`,
          content: {
            parts: [{ text }]
          }
        }),
        signal: controller.signal
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = (err as Error)?.name === 'AbortError';
      const msg = isAbort ? `Request timed out after ${this.timeoutMs}ms` : (err as Error)?.message;
      const error = new Error(`Gemini Embedding network error: ${msg}`);
      if (isAbort) error.name = 'TimeoutError';
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(
        `Gemini Embedding API returned HTTP ${response.status}: ${response.statusText}`
      );
      (err as unknown as { status: number; details: string }).status = response.status;
      (err as unknown as { status: number; details: string }).details = errText;
      throw err;
    }

    const responseBody = (await response.json()) as {
      embedding?: {
        values?: number[];
      };
    };

    const values = responseBody.embedding?.values;
    if (!values || !Array.isArray(values) || values.length === 0) {
      throw new Error('Gemini Embedding API returned an empty or invalid embedding vector');
    }

    if (values.length !== this.expectedDimensions) {
      throw new Error(
        `Gemini Embedding dimension mismatch: expected ${this.expectedDimensions}, received ${values.length}`
      );
    }

    // Verify all values are valid numbers (no NaN or Infinity)
    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (val === undefined || !Number.isFinite(val)) {
        throw new Error(`Gemini Embedding contained non-finite value at index ${i}`);
      }
    }

    const inputTokens = Math.ceil(text.length / 4);
    // text-embedding-004 free tier / approx $0.00002 / 1000 chars
    const estimatedCostUsd = Number(((inputTokens / 1_000_000) * 0.02).toFixed(8));

    return {
      embedding: values,
      dimensions: values.length,
      inputTokens,
      latencyMs,
      estimatedCostUsd,
      model: this.modelName,
      provider: this.providerName
    };
  }
}
