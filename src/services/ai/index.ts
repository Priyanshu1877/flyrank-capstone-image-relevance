export * from './types.js';
export * from './embeddingText.js';
export * from './MockVisionProvider.js';
export * from './MockEmbeddingProvider.js';
export * from './GeminiVisionProvider.js';
export * from './GeminiEmbeddingProvider.js';

import { IVisionProvider, IEmbeddingProvider } from './types.js';
import { MockVisionProvider, MockVisionOptions } from './MockVisionProvider.js';
import { MockEmbeddingProvider, MockEmbeddingOptions } from './MockEmbeddingProvider.js';
import { GeminiVisionProvider, GeminiVisionOptions } from './GeminiVisionProvider.js';
import { GeminiEmbeddingProvider, GeminiEmbeddingOptions } from './GeminiEmbeddingProvider.js';

export function resolveVisionProvider(
  type?: string,
  options?: MockVisionOptions & GeminiVisionOptions
): IVisionProvider {
  const providerType = (type || process.env.AI_PROVIDER || 'mock').toLowerCase();

  if (providerType === 'gemini') {
    return new GeminiVisionProvider(options);
  }

  return new MockVisionProvider(options);
}

export function resolveEmbeddingProvider(
  type?: string,
  options?: MockEmbeddingOptions & GeminiEmbeddingOptions
): IEmbeddingProvider {
  const providerType = (type || process.env.AI_PROVIDER || 'mock').toLowerCase();

  if (providerType === 'gemini') {
    return new GeminiEmbeddingProvider(options);
  }

  return new MockEmbeddingProvider(options);
}
