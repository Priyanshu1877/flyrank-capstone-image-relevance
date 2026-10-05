import { VisionMetadataInput } from '../../schemas/index.js';

/**
 * Derives a deterministic, normalized textual representation from validated vision metadata
 * for dense semantic embedding indexing and vector similarity search.
 */
export function buildEmbeddingInputText(metadata: VisionMetadataInput): string {
  const normalizedSubject = metadata.subject.trim().toLowerCase();
  const normalizedCategory = metadata.category.trim().toLowerCase();
  const normalizedAttributes = metadata.attributes
    .map((a) => a.trim().toLowerCase())
    .sort() // Deterministic ordering
    .join(', ');
  const normalizedCaption = metadata.caption.trim();

  return `Category: ${normalizedCategory}. Subject: ${normalizedSubject}. Attributes: ${normalizedAttributes}. Description: ${normalizedCaption}`;
}
