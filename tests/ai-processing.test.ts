import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePool, query, withTransaction } from '../src/config/database.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { ImageMetadataRepository } from '../src/repositories/ImageMetadataRepository.js';
import { ImageVectorRepository } from '../src/repositories/ImageVectorRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { JobFailureRepository } from '../src/repositories/JobFailureRepository.js';
import { AICallRepository } from '../src/repositories/AICallRepository.js';
import { BudgetEventRepository } from '../src/repositories/BudgetEventRepository.js';
import { TenantAuthenticator } from '../src/utils/auth.js';
import { Tenant } from '../src/models/types.js';
import {
  MockVisionProvider,
  MockEmbeddingProvider,
  buildEmbeddingInputText
} from '../src/services/ai/index.js';
import {
  ImageProcessorService,
  PermanentProcessingError
} from '../src/services/ImageProcessorService.js';
import { BudgetGuardService, BudgetExhaustedError } from '../src/services/BudgetGuardService.js';
import { JobWorker } from '../src/workers/JobWorker.js';
import { loadImageBytes, SecurityError } from '../src/utils/imageLoader.js';

describe('Phase 4: AI Processing, Embedding Pipeline & Job Worker', () => {
  const tenantRepo = new TenantRepository();
  const imageRepo = new ImageRepository();
  const metadataRepo = new ImageMetadataRepository();
  const vectorRepo = new ImageVectorRepository();
  const jobRepo = new JobRepository();
  const failureRepo = new JobFailureRepository();
  const aiCallRepo = new AICallRepository();
  const budgetEventRepo = new BudgetEventRepository();
  const auth = new TenantAuthenticator(tenantRepo);

  let testTenantA: Tenant;
  let testTenantB: Tenant;
  const rawKeyA = `ai-test-tenant-a-${Date.now()}`;
  const rawKeyB = `ai-test-tenant-b-${Date.now()}`;

  beforeAll(async () => {
    testTenantA = await tenantRepo.create({
      name: 'AI Processing Tenant Alpha',
      apiKeyHash: auth.hashApiKey(rawKeyA),
      maxBudgetUsd: 10.0
    });

    testTenantB = await tenantRepo.create({
      name: 'AI Processing Tenant Beta',
      apiKeyHash: auth.hashApiKey(rawKeyB),
      maxBudgetUsd: 10.0
    });
  });

  afterAll(async () => {
    // Clean up test data
    const tIds = [testTenantA.id, testTenantB.id];
    await query('DELETE FROM job_failures WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM jobs WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM ai_calls WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM budget_events WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM image_vectors WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM image_metadata WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM images WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM tenants WHERE id = ANY($1)', [tIds]);
    await closePool();
  });

  it('1. Mock Providers: verifies deterministic vision and embedding behavior', async () => {
    const vision = new MockVisionProvider({ scenario: 'high_confidence_fox' });
    const buffer = Buffer.from('mock-bytes');
    const vResult = await vision.analyzeImage(buffer, 'image/jpeg');

    expect(vResult.metadata.subject).toBe('red fox');
    expect(vResult.metadata.category).toBe('wildlife');
    expect(vResult.metadata.confidence).toBeGreaterThanOrEqual(0.7);
    expect(vResult.inputTokens).toBeGreaterThan(0);
    expect(vResult.estimatedCostUsd).toBeGreaterThan(0);

    const embedding = new MockEmbeddingProvider();
    const eResult = await embedding.generateEmbedding('Category: wildlife. Subject: red fox');
    expect(eResult.dimensions).toBe(768);
    expect(eResult.embedding).toHaveLength(768);

    // Verify L2 unit norm of embedding vector
    const norm = Math.sqrt(eResult.embedding.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });

  it('2. Deterministic Embedding Text Builder: normalizes subject, category, sorted attributes and caption', () => {
    const text = buildEmbeddingInputText({
      subject: ' Red Fox ',
      category: ' Wildlife ',
      attributes: ['Wild', 'Canine', 'Fur'],
      caption: 'A red fox resting in the snow.',
      confidence: 0.95
    });

    expect(text).toBe(
      'Category: wildlife. Subject: red fox. Attributes: canine, fur, wild. Description: A red fox resting in the snow.'
    );
  });

  it('3. Successful Image Processing: persists metadata, vector, and telemetry', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-test-proc-01?w=640`,
      originalFilename: 'wildlife/wildlife_01_red_fox.jpg'
    });

    const processor = new ImageProcessorService();
    const visionProvider = new MockVisionProvider({ scenario: 'high_confidence_fox' });
    const embeddingProvider = new MockEmbeddingProvider();

    const result = await processor.processImage(testTenantA.id, 'job-test-01', image.id, {
      visionProvider,
      embeddingProvider
    });

    expect(result.image.status).toBe('completed');
    expect(result.image.flagged).toBe(false);
    expect(result.isQuarantined).toBe(false);
    expect(result.metadata.subject).toBe('red fox');
    expect(result.metadata.category).toBe('wildlife');
    expect(result.vector.dimensions).toBe(768);

    // Verify database persistence
    const savedMeta = await metadataRepo.findByImageId(testTenantA.id, image.id);
    expect(savedMeta).not.toBeNull();
    expect(savedMeta?.subject).toBe('red fox');

    const savedVec = await vectorRepo.findByImageId(testTenantA.id, image.id);
    expect(savedVec).not.toBeNull();
    expect(savedVec?.dimensions).toBe(768);

    // Verify telemetry in ai_calls
    const calls = await aiCallRepo.listRecent(testTenantA.id, 5);
    const visionCall = calls.find((c) => c.taskType === 'vision_metadata');
    const embeddingCall = calls.find((c) => c.taskType === 'text_embedding');
    expect(visionCall).toBeDefined();
    expect(embeddingCall).toBeDefined();
    expect(visionCall?.status).toBe('success');
  });

  it('4. Low-Confidence Quarantine: flags image when confidence < 0.70', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-test-quarantine-01?w=640`,
      originalFilename: 'wildlife/wildlife_02_gray_wolf.jpg'
    });

    const processor = new ImageProcessorService();
    const visionProvider = new MockVisionProvider({ scenario: 'low_confidence' });
    const embeddingProvider = new MockEmbeddingProvider();

    const result = await processor.processImage(testTenantA.id, 'job-test-quarantine', image.id, {
      visionProvider,
      embeddingProvider,
      confidenceFloor: 0.7
    });

    expect(result.isQuarantined).toBe(true);
    expect(result.image.flagged).toBe(true);
    expect(result.quarantineReason).toContain('below minimum threshold');

    // Confirm image in database has flagged = true
    const refreshed = await imageRepo.findById(testTenantA.id, image.id);
    expect(refreshed?.flagged).toBe(true);
    expect(refreshed?.status).toBe('completed');
  });

  it('5. Vision Schema Validation: rejects malformed provider output', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-test-malformed?w=640`,
      originalFilename: 'wildlife/wildlife_03_brown_bear.jpg'
    });

    const processor = new ImageProcessorService();
    const visionProvider = new MockVisionProvider({ scenario: 'invalid_schema' });

    await expect(
      processor.processImage(testTenantA.id, 'job-malformed', image.id, {
        visionProvider
      })
    ).rejects.toThrow(PermanentProcessingError);

    // Confirm no invalid metadata was persisted
    const metadata = await metadataRepo.findByImageId(testTenantA.id, image.id);
    expect(metadata).toBeNull();
  });

  it('6. Invalid Embedding Rejection: rejects wrong dimensions or non-finite numbers', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-test-bad-vector?w=640`,
      originalFilename: 'wildlife/wildlife_04_river_otter.jpg'
    });

    const processor = new ImageProcessorService();
    const visionProvider = new MockVisionProvider({ scenario: 'high_confidence_fox' });
    const embeddingProvider = new MockEmbeddingProvider({ scenario: 'invalid_dimensions' });

    await expect(
      processor.processImage(testTenantA.id, 'job-bad-vector', image.id, {
        visionProvider,
        embeddingProvider
      })
    ).rejects.toThrow(PermanentProcessingError);

    // Confirm no corrupted vector was persisted
    const vector = await vectorRepo.findByImageId(testTenantA.id, image.id);
    expect(vector).toBeNull();
  });

  it('7. Budget Guard Enforcement: halts processing before provider invocation when budget exhausted', async () => {
    // Create tenant with zero budget ceiling
    const brokeTenant = await tenantRepo.create({
      name: 'Broke Publications',
      apiKeyHash: auth.hashApiKey(`broke-key-${Date.now()}`),
      maxBudgetUsd: 0.00001
    });

    // Record artificial spend to exceed budget
    await aiCallRepo.record(brokeTenant.id, {
      callIdentity: `seed-spend-${Date.now()}`,
      operationId: 'seed',
      provider: 'mock',
      model: 'mock',
      taskType: 'vision_metadata',
      latencyMs: 10,
      status: 'success',
      estimatedCostUsd: 0.05
    });

    const budgetGuard = new BudgetGuardService();
    const check = await budgetGuard.checkBudget(brokeTenant.id, 'TEST_ACTION');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Budget exhausted');

    // Confirm budget event was recorded
    const events = await budgetEventRepo.listRecent(brokeTenant.id, 5);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.attemptedAction).toBe('TEST_ACTION');

    // Attempting to process image must throw BudgetExhaustedError
    const image = await imageRepo.create(brokeTenant.id, {
      url: 'https://images.unsplash.com/photo-broke-test',
      originalFilename: 'wildlife/wildlife_05_red_deer.jpg'
    });

    const processor = new ImageProcessorService();
    await expect(
      processor.processImage(brokeTenant.id, 'job-budget-fail', image.id)
    ).rejects.toThrow(BudgetExhaustedError);

    // Clean up broke tenant
    await query('DELETE FROM ai_calls WHERE tenant_id = $1', [brokeTenant.id]);
    await query('DELETE FROM budget_events WHERE tenant_id = $1', [brokeTenant.id]);
    await query('DELETE FROM images WHERE tenant_id = $1', [brokeTenant.id]);
    await query('DELETE FROM tenants WHERE id = $1', [brokeTenant.id]);
  });

  it('8. Job Worker: claims, executes, and marks job completed', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-worker-test-01?w=640`,
      originalFilename: 'technology/technology_01_laptop.jpg'
    });

    const job = await jobRepo.enqueue(testTenantA.id, {
      idempotencyKey: `worker-key-${Date.now()}`,
      type: 'PROCESS_IMAGE',
      payload: { imageId: image.id, url: image.url }
    });

    const worker = new JobWorker({
      tenantId: testTenantA.id,
      visionProvider: new MockVisionProvider({ scenario: 'tech_laptop' }),
      embeddingProvider: new MockEmbeddingProvider()
    });

    const outcome = await worker.executeJob(job);
    expect(outcome).toBe('succeeded');

    // Verify job in database is marked completed
    const updatedJob = await jobRepo.findById(testTenantA.id, job.id);
    expect(updatedJob?.status).toBe('completed');
    expect(updatedJob?.completedAt).not.toBeNull();

    // Verify image is completed
    const updatedImage = await imageRepo.findById(testTenantA.id, image.id);
    expect(updatedImage?.status).toBe('completed');
  });

  it('9. Job Worker Transient Failure & Exponential Retry: reschedules on rate limit (429)', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-retry-test?w=640`,
      originalFilename: 'culinary/culinary_01_espresso.jpg'
    });

    const job = await jobRepo.enqueue(testTenantA.id, {
      idempotencyKey: `retry-key-${Date.now()}`,
      type: 'PROCESS_IMAGE',
      payload: { imageId: image.id, url: image.url }
    });

    const worker = new JobWorker({
      tenantId: testTenantA.id,
      visionProvider: new MockVisionProvider({ scenario: 'rate_limit' }),
      baseBackoffMs: 2000
    });

    const outcome = await worker.executeJob(job);
    expect(outcome).toBe('failed');

    // Confirm job is rescheduled for retry (status remains 'queued', scheduled_at is in future)
    const refreshedJob = await jobRepo.findById(testTenantA.id, job.id);
    expect(refreshedJob?.status).toBe('queued');
    expect(refreshedJob?.scheduledAt.getTime()).toBeGreaterThan(Date.now());

    // Confirm job failure was recorded
    const failures = await failureRepo.listByJob(testTenantA.id, job.id);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorMessage).toContain('[TRANSIENT]');
  });

  it('10. Job Worker Permanent Failure: immediately fails without retrying', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-permanent-test?w=640`,
      originalFilename: 'architecture/architecture_01_brutalist.jpg'
    });

    const job = await jobRepo.enqueue(testTenantA.id, {
      idempotencyKey: `perm-fail-key-${Date.now()}`,
      type: 'PROCESS_IMAGE',
      payload: { imageId: image.id, url: image.url }
    });

    const worker = new JobWorker({
      tenantId: testTenantA.id,
      visionProvider: new MockVisionProvider({ scenario: 'invalid_schema' })
    });

    const outcome = await worker.executeJob(job);
    expect(outcome).toBe('failed');

    // Confirm job is marked permanently failed
    const refreshedJob = await jobRepo.findById(testTenantA.id, job.id);
    expect(refreshedJob?.status).toBe('failed');

    // Confirm image is marked failed
    const refreshedImage = await imageRepo.findById(testTenantA.id, image.id);
    expect(refreshedImage?.status).toBe('failed');
  });

  it('11. Idempotency: re-processing existing image updates records without duplicating rows', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-idempotent-proc?w=640`,
      originalFilename: 'wildlife/wildlife_06_bald_eagle.jpg'
    });

    const processor = new ImageProcessorService();
    const vision = new MockVisionProvider({ scenario: 'high_confidence_fox' });
    const embedding = new MockEmbeddingProvider();

    // Run 1
    await processor.processImage(testTenantA.id, 'job-idemp-1', image.id, {
      visionProvider: vision,
      embeddingProvider: embedding
    });

    // Run 2 (re-processing)
    await processor.processImage(testTenantA.id, 'job-idemp-2', image.id, {
      visionProvider: vision,
      embeddingProvider: embedding
    });

    // Confirm exactly 1 metadata row and 1 vector row exist
    const metaCount = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM image_metadata WHERE tenant_id = $1 AND image_id = $2',
      [testTenantA.id, image.id]
    );
    const vectorCount = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM image_vectors WHERE tenant_id = $1 AND image_id = $2',
      [testTenantA.id, image.id]
    );

    expect(parseInt(metaCount.rows[0]?.count ?? '0', 10)).toBe(1);
    expect(parseInt(vectorCount.rows[0]?.count ?? '0', 10)).toBe(1);
  });

  it('12. Concurrent Worker Safety: FOR UPDATE SKIP LOCKED guarantees only 1 worker claims a job', async () => {
    const image = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-concurrent-safety?w=640`,
      originalFilename: 'wildlife/wildlife_07_siberian_tiger.jpg'
    });

    const job = await jobRepo.enqueue(testTenantA.id, {
      idempotencyKey: `concurrent-claim-${Date.now()}`,
      type: 'PROCESS_IMAGE',
      payload: { imageId: image.id }
    });

    // Worker 1 holds open a transaction on candidate job
    await withTransaction(async (client1) => {
      const claimed1 = await jobRepo.fetchNextAvailable(testTenantA.id, client1);
      expect(claimed1?.id).toBe(job.id);

      // Worker 2 attempts to claim next available concurrently inside its own transaction
      await withTransaction(async (client2) => {
        const claimed2 = await jobRepo.fetchNextAvailable(testTenantA.id, client2);
        // SKIP LOCKED skips the locked row and returns null!
        expect(claimed2).toBeNull();
      });
    });
  });

  it('13. Tenant Isolation: guarantees isolation of metadata, vectors, and AI spend', async () => {
    const imgA = await imageRepo.create(testTenantA.id, {
      url: `https://images.unsplash.com/photo-tenant-shared-url?w=640`,
      originalFilename: 'wildlife/wildlife_08_african_lion.jpg'
    });
    const imgB = await imageRepo.create(testTenantB.id, {
      url: `https://images.unsplash.com/photo-tenant-shared-url?w=640`,
      originalFilename: 'wildlife/wildlife_08_african_lion.jpg'
    });
    expect(imgB.id).toBeDefined();

    const processor = new ImageProcessorService();
    await processor.processImage(testTenantA.id, 'job-iso-a', imgA.id);

    // Tenant B cannot see Tenant A's metadata or vector
    const crossMeta = await metadataRepo.findByImageId(testTenantB.id, imgA.id);
    const crossVec = await vectorRepo.findByImageId(testTenantB.id, imgA.id);
    expect(crossMeta).toBeNull();
    expect(crossVec).toBeNull();

    // Tenant B spend is 0, unaffected by Tenant A
    const spendB = await aiCallRepo.getTenantCumulativeSpend(testTenantB.id);
    expect(spendB).toBe(0.0);
  });

  it('14. SSRF & Path Traversal Security: blocks internal IP requests and path escape', async () => {
    // SSRF attempt against AWS/GCP cloud metadata
    await expect(loadImageBytes('http://169.254.169.254/computeMetadata/v1/')).rejects.toThrow(
      SecurityError
    );

    // SSRF attempt against localhost loopback
    await expect(loadImageBytes('http://127.0.0.1:8080/internal/metrics')).rejects.toThrow(
      SecurityError
    );

    // Path traversal attempt via originalFilename
    await expect(
      loadImageBytes('https://example.com/test.jpg', '../../../../windows/win.ini')
    ).rejects.toThrow(SecurityError);
  });

  it('15. Security: verifies zero secret leakage in logs and telemetry tables', async () => {
    const recentCalls = await aiCallRepo.listRecent(testTenantA.id, 20);
    for (const call of recentCalls) {
      // Must not contain API keys or auth headers
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('mock-dev-key');
      expect(serialized).not.toContain('Bearer ');
      expect(serialized).not.toContain('authorization');
    }

    const failuresRes = await query<{ error_message: string }>(
      'SELECT error_message FROM job_failures WHERE tenant_id = $1',
      [testTenantA.id]
    );
    for (const f of failuresRes.rows) {
      expect(f.error_message).not.toContain('AI_API_KEY');
      expect(f.error_message).not.toContain('GEMINI_API_KEY');
    }
  });
});
