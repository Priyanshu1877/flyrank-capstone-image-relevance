export interface CosineSimilarityResult {
  isValid: boolean;
  similarity: number;
  error?: string;
}

/**
 * Computes cosine similarity between two numeric vector arrays:
 *   cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)
 *
 * Defensively handles null/undefined vectors, mismatched dimensions,
 * zero vectors, and non-finite values (NaN / Infinity).
 */
export function calculateCosineSimilarity(
  vecA: number[] | null | undefined,
  vecB: number[] | null | undefined
): CosineSimilarityResult {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB)) {
    return {
      isValid: false,
      similarity: 0.0,
      error: 'One or both vectors are null, undefined, or not arrays'
    };
  }

  if (vecA.length === 0 || vecB.length === 0) {
    return {
      isValid: false,
      similarity: 0.0,
      error: 'Vector dimension cannot be zero'
    };
  }

  if (vecA.length !== vecB.length) {
    return {
      isValid: false,
      similarity: 0.0,
      error: `Vector dimension mismatch: vector A has length ${vecA.length}, vector B has length ${vecB.length}`
    };
  }

  let dotProduct = 0;
  let normSqA = 0;
  let normSqB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];

    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) {
      return {
        isValid: false,
        similarity: 0.0,
        error: `Vector contains non-finite numeric value (NaN or Infinity) at index ${i}`
      };
    }

    dotProduct += a * b;
    normSqA += a * a;
    normSqB += b * b;
  }

  if (normSqA <= 0 || normSqB <= 0) {
    return {
      isValid: false,
      similarity: 0.0,
      error: 'One or both vectors have zero magnitude (zero vector)'
    };
  }

  const denominator = Math.sqrt(normSqA) * Math.sqrt(normSqB);
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return {
      isValid: false,
      similarity: 0.0,
      error: 'Denominator evaluated to zero or non-finite'
    };
  }

  const rawSim = dotProduct / denominator;
  // Clamp to valid cosine range [-1.0, 1.0]
  const clampedSim = Math.max(-1.0, Math.min(1.0, rawSim));
  const roundedSim = Number(clampedSim.toFixed(6));

  return {
    isValid: true,
    similarity: roundedSim
  };
}
