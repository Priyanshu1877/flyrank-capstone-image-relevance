import pg from 'pg';
import { getPool, withTransaction } from '../config/database.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { JobFailureRepository } from '../repositories/JobFailureRepository.js';
import { ImageRepository } from '../repositories/ImageRepository.js';
import {
  ImageProcessorService,
  PermanentProcessingError,
  TransientProcessingError
} from '../services/ImageProcessorService.js';
import { BudgetExhaustedError } from '../services/BudgetGuardService.js';
import { IVisionProvider, IEmbeddingProvider } from '../services/ai/types.js';
import { Job } from '../models/types.js';

export interface JobWorkerOptions {
  tenantId?: string;
  visionProvider?: IVisionProvider;
  embeddingProvider?: IEmbeddingProvider;
  baseBackoffMs?: number;
  poolOverride?: pg.Pool;
}

export interface WorkerBatchResult {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  budgetRejected: number;
}

export class JobWorker {
  private readonly jobRepo = new JobRepository();
  private readonly failureRepo = new JobFailureRepository();
  private readonly imageRepo = new ImageRepository();
  private readonly processor = new ImageProcessorService();

  private readonly tenantId?: string;
  private readonly visionProvider?: IVisionProvider;
  private readonly embeddingProvider?: IEmbeddingProvider;
  private readonly baseBackoffMs: number;
  private readonly pool: pg.Pool;

  constructor(options: JobWorkerOptions = {}) {
    this.tenantId = options.tenantId;
    this.visionProvider = options.visionProvider;
    this.embeddingProvider = options.embeddingProvider;
    this.baseBackoffMs = options.baseBackoffMs ?? 5000;
    this.pool = options.poolOverride ?? getPool();
  }

  /**
   * Atomically claims the next eligible job using SELECT FOR UPDATE SKIP LOCKED.
   * Marking processing is done inside the claim transaction; execution is done outside.
   */
  async claimNextJob(): Promise<Job | null> {
    return withTransaction(async (client) => {
      const candidate = this.tenantId
        ? await this.jobRepo.fetchNextAvailable(this.tenantId, client)
        : await this.jobRepo.fetchNextAvailableAnyTenant(client);

      if (!candidate) return null;

      // Transition to 'processing' and increment attempts atomically
      return await this.jobRepo.markProcessing(candidate.tenantId, candidate.id, client);
    }, this.pool);
  }

  /**
   * Executes a claimed job and handles all state transitions, retries, and errors.
   */
  async executeJob(job: Job): Promise<'succeeded' | 'failed' | 'budget_rejected'> {
    const startTime = Date.now();
    const imageId = (job.payload as { imageId?: string })?.imageId;
    const attemptNumber = Math.max(1, job.attempts);

    console.log(
      `[JobWorker] Claimed job ${job.id} (tenant: ${job.tenantId}, type: ${job.type}, attempt: ${attemptNumber}/${job.maxAttempts})`
    );

    if (job.type !== 'PROCESS_IMAGE' || !imageId) {
      const errMessage = `Unsupported job type '${job.type}' or missing imageId in payload`;
      await this.failureRepo.record(job.tenantId, {
        jobId: job.id,
        attempt: attemptNumber,
        errorMessage: errMessage
      });
      await this.jobRepo.markFailed(job.tenantId, job.id, null, this.pool);
      return 'failed';
    }

    try {
      // Execute Image Processing Pipeline
      const result = await this.processor.processImage(job.tenantId, job.id, imageId, {
        visionProvider: this.visionProvider,
        embeddingProvider: this.embeddingProvider,
        attempt: attemptNumber
      });

      // Mark Job Completed
      await this.jobRepo.markCompleted(job.tenantId, job.id, this.pool);

      const durationMs = Date.now() - startTime;
      console.log(
        `[JobWorker] Completed job ${job.id} in ${durationMs}ms: image ${imageId} (${result.metadata.subject}, confidence: ${result.metadata.confidence}${
          result.isQuarantined ? ' [QUARANTINED]' : ''
        })`
      );

      return 'succeeded';
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const error = err as Error;

      // Case A: Controlled Budget Exhaustion
      if (err instanceof BudgetExhaustedError) {
        console.warn(
          `[JobWorker] Job ${job.id} halted by budget guard in ${durationMs}ms: ${error.message}`
        );
        await this.jobRepo.markBudgetRejected(job.tenantId, job.id, this.pool);
        await this.failureRepo.record(job.tenantId, {
          jobId: job.id,
          attempt: attemptNumber,
          errorMessage: error.message
        });
        return 'budget_rejected';
      }

      // Case B: Permanent Processing Failure (Do NOT retry)
      if (err instanceof PermanentProcessingError) {
        console.error(
          `[JobWorker] Job ${job.id} encountered PERMANENT failure in ${durationMs}ms: ${error.message}`
        );
        await this.jobRepo.markFailed(job.tenantId, job.id, null, this.pool);
        await this.imageRepo.updateStatus(job.tenantId, imageId, 'failed');
        await this.failureRepo.record(job.tenantId, {
          jobId: job.id,
          attempt: attemptNumber,
          errorMessage: error.message,
          stackTrace: error.stack
        });
        return 'failed';
      }

      // Case C: Transient / Retryable Failure (Retry with exponential backoff if attempts < maxAttempts)
      const isTransient = err instanceof TransientProcessingError;
      const canRetry = job.attempts < job.maxAttempts;

      if (canRetry) {
        const backoffMultiplier = Math.pow(2, Math.max(0, attemptNumber - 1));
        const delayMs = this.baseBackoffMs * backoffMultiplier;
        const nextScheduledAt = new Date(Date.now() + delayMs);

        console.warn(
          `[JobWorker] Job ${job.id} ${isTransient ? 'transient' : 'recoverable'} failure (${error.message}). Retrying in ${delayMs}ms (attempt ${attemptNumber}/${job.maxAttempts})`
        );

        await this.jobRepo.markFailed(job.tenantId, job.id, nextScheduledAt, this.pool);
        await this.failureRepo.record(job.tenantId, {
          jobId: job.id,
          attempt: attemptNumber,
          errorMessage: `[${isTransient ? 'TRANSIENT' : 'RETRYABLE'}] ${error.message}`,
          stackTrace: error.stack
        });
        return 'failed';
      } else {
        console.error(
          `[JobWorker] Job ${job.id} exhausted all ${job.maxAttempts} attempts. Marking permanently failed.`
        );
        await this.jobRepo.markFailed(job.tenantId, job.id, null, this.pool);
        await this.imageRepo.updateStatus(job.tenantId, imageId, 'failed');
        await this.failureRepo.record(job.tenantId, {
          jobId: job.id,
          attempt: attemptNumber,
          errorMessage: `[MAX_ATTEMPTS_EXCEEDED] ${error.message}`,
          stackTrace: error.stack
        });
        return 'failed';
      }
    }
  }

  /**
   * Claims and processes a single job if available.
   */
  async processNext(): Promise<boolean> {
    const job = await this.claimNextJob();
    if (!job) return false;
    await this.executeJob(job);
    return true;
  }

  /**
   * Processes all queued jobs until the queue is exhausted or maxJobs is reached.
   */
  async drain(maxJobs = 1000): Promise<WorkerBatchResult> {
    const result: WorkerBatchResult = {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0,
      budgetRejected: 0
    };

    while (result.totalProcessed < maxJobs) {
      const job = await this.claimNextJob();
      if (!job) break;

      result.totalProcessed++;
      const outcome = await this.executeJob(job);

      if (outcome === 'succeeded') result.succeeded++;
      else if (outcome === 'budget_rejected') result.budgetRejected++;
      else result.failed++;
    }

    return result;
  }

  /**
   * Recovers jobs that were left in 'processing' status past stale threshold (e.g. after crash).
   */
  async recoverStaleLocks(thresholdMinutes = 5): Promise<number> {
    return this.jobRepo.reclaimStaleJobs(thresholdMinutes, this.pool);
  }
}
