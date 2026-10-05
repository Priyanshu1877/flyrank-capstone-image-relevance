import { VisionMetadataInput } from '../../schemas/index.js';

export interface VisionAnalysisResult {
  metadata: VisionMetadataInput;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  model: string;
  provider: string;
  rawResponse?: Record<string, unknown>;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  inputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  model: string;
  provider: string;
}

export interface IVisionProvider {
  readonly providerName: string;
  readonly modelName: string;
  analyzeImage(
    imageBuffer: Buffer,
    mimeType: string,
    options?: { prompt?: string; contextHint?: string }
  ): Promise<VisionAnalysisResult>;
}

export interface IEmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly expectedDimensions: number;
  generateEmbedding(text: string): Promise<EmbeddingResult>;
}
