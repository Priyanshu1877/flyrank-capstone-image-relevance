import crypto from 'node:crypto';
import pg from 'pg';
import { withTransaction } from '../config/database.js';
import { Image, Job } from '../models/types.js';
import { ImageRepository } from '../repositories/ImageRepository.js';
import { JobRepository } from '../repositories/JobRepository.js';

export interface IngestImageTransactionResult {
  image: Image;
  job: Job;
}

export class ImageIngestionTransaction {
  constructor(
    private readonly imageRepo = new ImageRepository(),
    private readonly jobRepo = new JobRepository()
  ) {}

  /**
   * Atomically registers an image and enqueues its visual processing job
   * inside a single transaction. If either step fails, the entire transaction rolls back.
   */
  async execute(
    tenantId: string,
    url: string,
    originalFilename?: string | null,
    poolOverride?: pg.Pool
  ): Promise<IngestImageTransactionResult> {
    return withTransaction(async (client) => {
      // Step 1: Create or upsert image record
      const image = await this.imageRepo.create(tenantId, { url, originalFilename }, client);

      // Step 2: Compute deterministic idempotency key for the processing job
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`${tenantId}:process_image:${image.id}`)
        .digest('hex');

      // Step 3: Enqueue background job with the idempotency key
      const job = await this.jobRepo.enqueue(
        tenantId,
        {
          idempotencyKey,
          type: 'PROCESS_IMAGE',
          payload: {
            imageId: image.id,
            url: image.url
          }
        },
        client
      );

      return { image, job };
    }, poolOverride);
  }
}
