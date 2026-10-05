import { ImageRepository } from '../repositories/ImageRepository.js';
import { ImageMetadataRepository } from '../repositories/ImageMetadataRepository.js';
import { ImageVectorRepository } from '../repositories/ImageVectorRepository.js';
import { BudgetGuardService } from './BudgetGuardService.js';
import {
  IVisionProvider,
  IEmbeddingProvider,
  resolveVisionProvider,
  resolveEmbeddingProvider,
  buildEmbeddingInputText
} from './ai/index.js';
import { loadImageBytes, SecurityError } from '../utils/imageLoader.js';
import { VisionMetadataSchema } from '../schemas/index.js';
import { Image, ImageMetadata, ImageVector } from '../models/types.js';

export class PermanentProcessingError extends Error {
  constructor(
    message: string,
    public readonly causeError?: unknown
  ) {
    super(message);
    this.name = 'PermanentProcessingError';
  }
}

export class TransientProcessingError extends Error {
  constructor(
    message: string,
    public readonly causeError?: unknown
  ) {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

export interface ImageProcessOptions {
  visionProvider?: IVisionProvider;
  embeddingProvider?: IEmbeddingProvider;
  confidenceFloor?: number;
  attempt?: number;
}

export interface ImageProcessResult {
  image: Image;
  metadata: ImageMetadata;
  vector: ImageVector;
  isQuarantined: boolean;
  quarantineReason?: string;
}

export class ImageProcessorService {
  constructor(
    private readonly imageRepo = new ImageRepository(),
    private readonly metadataRepo = new ImageMetadataRepository(),
    private readonly vectorRepo = new ImageVectorRepository(),
    private readonly budgetGuard = new BudgetGuardService()
  ) {}

  /**
   * Transforms an ingested image into structured vision metadata and semantic vector embedding.
   */
  async processImage(
    tenantId: string,
    jobId: string,
    imageId: string,
    options: ImageProcessOptions = {}
  ): Promise<ImageProcessResult> {
    const attempt = options.attempt ?? 1;
    const confidenceFloor = options.confidenceFloor ?? 0.7; // Phase 1 provisional floor

    // Step 1: Load image record
    const image = await this.imageRepo.findById(tenantId, imageId);
    if (!image) {
      throw new PermanentProcessingError(`Image ${imageId} not found for tenant ${tenantId}`);
    }

    const visionProvider = options.visionProvider ?? resolveVisionProvider();
    const embeddingProvider = options.embeddingProvider ?? resolveEmbeddingProvider();

    // Step 2: Budget check before vision model call
    await this.budgetGuard.assertBudgetAvailable(tenantId, 'PROCESS_IMAGE:vision');

    // Step 3: Securely load image bytes (SSRF protected)
    let loadedImage;
    try {
      loadedImage = await loadImageBytes(image.url, image.originalFilename);
    } catch (err: unknown) {
      if (err instanceof SecurityError) {
        throw new PermanentProcessingError(
          `Image security validation failed: ${(err as Error).message}`,
          err
        );
      }
      throw new TransientProcessingError(
        `Failed to retrieve image bytes: ${(err as Error).message}`,
        err
      );
    }

    // Step 4: Invoke Vision Model
    let visionResult;
    try {
      visionResult = await visionProvider.analyzeImage(loadedImage.buffer, loadedImage.mimeType, {
        contextHint: image.originalFilename ?? image.url
      });
    } catch (err: unknown) {
      this.classifyProviderError(err, 'Vision model invocation failed');
    }

    // Step 5: Strict schema validation of vision model output
    const validation = VisionMetadataSchema.safeParse(visionResult.metadata);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new PermanentProcessingError(`Vision output violated VisionMetadataSchema: ${issues}`);
    }

    const validatedMetadata = validation.data;

    // Step 6: Log Vision Telemetry
    await this.budgetGuard.recordTelemetry(tenantId, {
      callIdentity: `${jobId}:vision:${attempt}`,
      operationId: jobId,
      attempt,
      provider: visionResult.provider,
      model: visionResult.model,
      taskType: 'vision_metadata',
      inputTokens: visionResult.inputTokens,
      outputTokens: visionResult.outputTokens,
      totalTokens: visionResult.totalTokens,
      estimatedCostUsd: visionResult.estimatedCostUsd,
      latencyMs: visionResult.latencyMs,
      status: 'success'
    });

    // Step 7: Apply Confidence Quarantine Rule
    const isQuarantined = validatedMetadata.confidence < confidenceFloor;
    const quarantineReason = isQuarantined
      ? `Vision confidence (${validatedMetadata.confidence.toFixed(
          3
        )}) is below minimum threshold (${confidenceFloor.toFixed(3)})`
      : undefined;

    // Step 8: Persist Image Metadata
    const persistedMetadata = await this.metadataRepo.upsert(tenantId, {
      imageId: image.id,
      subject: validatedMetadata.subject,
      category: validatedMetadata.category,
      caption: validatedMetadata.caption,
      attributes: validatedMetadata.attributes,
      confidence: validatedMetadata.confidence,
      rawResponse: visionResult.rawResponse
    });

    // Step 9: Build deterministic embedding input text
    const embeddingInputText = buildEmbeddingInputText(validatedMetadata);

    // Step 10: Budget check before embedding model call
    await this.budgetGuard.assertBudgetAvailable(tenantId, 'PROCESS_IMAGE:embedding');

    // Step 11: Invoke Embedding Model
    let embeddingResult;
    try {
      embeddingResult = await embeddingProvider.generateEmbedding(embeddingInputText);
    } catch (err: unknown) {
      this.classifyProviderError(err, 'Embedding model invocation failed');
    }

    // Step 12: Validate Embedding Vector
    if (
      !Array.isArray(embeddingResult.embedding) ||
      embeddingResult.embedding.length !== embeddingProvider.expectedDimensions
    ) {
      throw new PermanentProcessingError(
        `Embedding vector dimensions mismatch: expected ${embeddingProvider.expectedDimensions}, received ${embeddingResult.embedding?.length}`
      );
    }

    for (let i = 0; i < embeddingResult.embedding.length; i++) {
      const val = embeddingResult.embedding[i];
      if (val === undefined || !Number.isFinite(val)) {
        throw new PermanentProcessingError(
          `Embedding vector contains non-finite numeric value at index ${i}`
        );
      }
    }

    // Step 13: Log Embedding Telemetry
    await this.budgetGuard.recordTelemetry(tenantId, {
      callIdentity: `${jobId}:embedding:${attempt}`,
      operationId: jobId,
      attempt,
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      taskType: 'text_embedding',
      inputTokens: embeddingResult.inputTokens,
      outputTokens: 0,
      totalTokens: embeddingResult.inputTokens,
      estimatedCostUsd: embeddingResult.estimatedCostUsd,
      latencyMs: embeddingResult.latencyMs,
      status: 'success'
    });

    // Step 14: Persist Vector Embedding
    const persistedVector = await this.vectorRepo.upsert(tenantId, {
      imageId: image.id,
      modelName: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
      embedding: embeddingResult.embedding
    });

    // Step 15: Transition Image Lifecycle Status
    // If quarantined, flagged = true (excluded from matching recommendations)
    const updatedImage = await this.imageRepo.updateStatus(
      tenantId,
      image.id,
      'completed',
      isQuarantined
    );

    return {
      image: updatedImage ?? image,
      metadata: persistedMetadata,
      vector: persistedVector,
      isQuarantined,
      quarantineReason
    };
  }

  /**
   * Distinguishes transient (retryable) errors from permanent errors.
   */
  private classifyProviderError(err: unknown, defaultMessage: string): never {
    const error = err as Error & { status?: number };
    const status = error.status;
    const msg = error.message || String(err);

    // HTTP 429 (Rate Limit) or 5xx or Network/Timeout are TRANSIENT
    if (
      status === 429 ||
      (status && status >= 500 && status < 600) ||
      error.name === 'TimeoutError' ||
      msg.includes('rate limit') ||
      msg.includes('timed out') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT')
    ) {
      throw new TransientProcessingError(`${defaultMessage}: ${msg}`, err);
    }

    // Client errors (400, 401, 403, 404, or validation failures) are PERMANENT
    throw new PermanentProcessingError(`${defaultMessage}: ${msg}`, err);
  }
}
