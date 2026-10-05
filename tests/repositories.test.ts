import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePool } from '../src/config/database.js';
import {
  TenantRepository,
  ImageRepository,
  ImageMetadataRepository,
  ImageVectorRepository,
  PostRepository,
  PostVectorRepository,
  TagRepository,
  SuggestionRepository,
  ReviewRepository,
  JobRepository,
  JobFailureRepository,
  AICallRepository,
  BudgetEventRepository
} from '../src/repositories/index.js';
import { ImageIngestionTransaction } from '../src/services/ImageIngestionTransaction.js';
import { Tenant } from '../src/models/types.js';

describe('Repository Layer & Transaction Scenarios', () => {
  const tenantRepo = new TenantRepository();
  const imageRepo = new ImageRepository();
  const metadataRepo = new ImageMetadataRepository();
  const vectorRepo = new ImageVectorRepository();
  const postRepo = new PostRepository();
  const postVectorRepo = new PostVectorRepository();
  const tagRepo = new TagRepository();
  const suggestionRepo = new SuggestionRepository();
  const reviewRepo = new ReviewRepository();
  const jobRepo = new JobRepository();
  const failureRepo = new JobFailureRepository();
  const aiCallRepo = new AICallRepository();
  const budgetEventRepo = new BudgetEventRepository();
  const ingestionTx = new ImageIngestionTransaction(imageRepo, jobRepo);

  let testTenant: Tenant;

  beforeAll(async () => {
    testTenant = await tenantRepo.create({
      name: 'Repository Test Publisher',
      apiKeyHash: `hash-repo-test-${Date.now()}`,
      maxBudgetUsd: 25.0
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it('1. TenantRepository: supports CRUD and budget updating', async () => {
    const fetched = await tenantRepo.findById(testTenant.id);
    expect(fetched?.name).toBe('Repository Test Publisher');
    expect(fetched?.maxBudgetUsd).toBe(25.0);

    const updated = await tenantRepo.updateBudget(testTenant.id, 50.0);
    expect(updated?.maxBudgetUsd).toBe(50.0);
  });

  it('2. ImageRepository: creates and lists tenant images with pagination', async () => {
    const img1 = await imageRepo.create(testTenant.id, {
      url: `https://example.com/repo-img-1-${Date.now()}.jpg`,
      originalFilename: 'fox-1.jpg'
    });
    expect(img1.status).toBe('pending');
    expect(img1.flagged).toBe(false);

    const list = await imageRepo.list(testTenant.id, { limit: 10 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.id === img1.id)).toBe(true);
  });

  it('3. ImageMetadataRepository: idempotently upserts structured vision metadata', async () => {
    const img = await imageRepo.create(testTenant.id, {
      url: `https://example.com/meta-test-${Date.now()}.jpg`
    });

    const meta = await metadataRepo.upsert(testTenant.id, {
      imageId: img.id,
      subject: 'red fox',
      category: 'animal',
      caption: 'A red fox standing gracefully in a snowy pine forest',
      attributes: ['orange fur', 'bushy tail', 'snow', 'wildlife'],
      confidence: 0.94
    });

    expect(meta.subject).toBe('red fox');
    expect(meta.confidence).toBe(0.94);
    expect(meta.attributes).toContain('orange fur');

    // Re-upsert with updated caption (idempotency check)
    const updatedMeta = await metadataRepo.upsert(testTenant.id, {
      imageId: img.id,
      subject: 'red fox',
      category: 'animal',
      caption: 'Updated: A red fox hunting in snowy pine trees',
      attributes: ['orange fur', 'bushy tail', 'winter'],
      confidence: 0.96
    });

    expect(updatedMeta.caption).toContain('Updated:');
    expect(updatedMeta.confidence).toBe(0.96);

    // Verify only 1 metadata record exists
    const fetched = await metadataRepo.findByImageId(testTenant.id, img.id);
    expect(fetched?.id).toBe(meta.id);
  });

  it('4. ImageVectorRepository: stores and lists normalized vector representations', async () => {
    const img = await imageRepo.create(testTenant.id, {
      url: `https://example.com/vector-test-${Date.now()}.jpg`
    });

    const mockVector = [0.12, -0.45, 0.78, 0.03];
    const vec = await vectorRepo.upsert(testTenant.id, {
      imageId: img.id,
      modelName: 'text-embedding-004',
      dimensions: 4,
      embedding: mockVector
    });

    expect(vec.dimensions).toBe(4);
    expect(vec.embedding).toEqual(mockVector);

    const allVectors = await vectorRepo.listAllForTenant(testTenant.id);
    expect(allVectors.some((v) => v.id === vec.id)).toBe(true);
  });

  it('5. PostRepository & PostVectorRepository: manages posts and vectors', async () => {
    const post = await postRepo.create(testTenant.id, {
      title: 'Vulpine Ecology in High Altitudes',
      slug: `vulpine-ecology-${Date.now()}`,
      body: 'Comprehensive guide covering red fox winter adaptation mechanisms.',
      primaryCategory: 'wildlife'
    });

    expect(post.status).toBe('draft');

    const postVec = await postVectorRepo.upsert(testTenant.id, {
      postId: post.id,
      modelName: 'text-embedding-004',
      dimensions: 4,
      embedding: [0.11, -0.44, 0.77, 0.04]
    });

    expect(postVec.postId).toBe(post.id);

    const fetchedPostVec = await postVectorRepo.findByPostId(testTenant.id, post.id);
    expect(fetchedPostVec?.dimensions).toBe(4);
  });

  it('6. TagRepository: normalizes tags and associates them with images', async () => {
    const img = await imageRepo.create(testTenant.id, {
      url: `https://example.com/tag-test-${Date.now()}.jpg`
    });

    const tag1 = await tagRepo.findOrCreate(testTenant.id, 'Wildlife');
    const tag2 = await tagRepo.findOrCreate(testTenant.id, 'wildlife'); // Case insensitive normalization
    expect(tag1.id).toBe(tag2.id);

    await tagRepo.associateWithImage(testTenant.id, img.id, tag1.id);
    const tags = await tagRepo.getTagsForImage(testTenant.id, img.id);
    expect(tags.length).toBe(1);
    expect(tags[0]?.name).toBe('wildlife');
  });

  it('7. SuggestionRepository & ReviewRepository: handles recommendations and feedback', async () => {
    const post = await postRepo.create(testTenant.id, {
      title: 'Review Workflow Post',
      slug: `review-flow-post-${Date.now()}`,
      body: 'Body content for suggestion and review testing.'
    });

    const img = await imageRepo.create(testTenant.id, {
      url: `https://example.com/suggestion-test-${Date.now()}.jpg`
    });

    const suggestion = await suggestionRepo.upsert(testTenant.id, {
      postId: post.id,
      imageId: img.id,
      similarityScore: 0.884,
      rank: 1,
      guardPassed: true,
      rejectionReason: null
    });

    expect(suggestion.similarityScore).toBe(0.884);
    expect(suggestion.guardPassed).toBe(true);

    const review = await reviewRepo.create(testTenant.id, {
      suggestionId: suggestion.id,
      decision: 'approved',
      notes: 'Accurate species match with high aesthetic quality.'
    });

    expect(review.decision).toBe('approved');

    const reviews = await reviewRepo.listBySuggestion(testTenant.id, suggestion.id);
    expect(reviews.length).toBe(1);
    expect(reviews[0]?.notes).toContain('Accurate species match');
  });

  it('8. JobRepository & JobFailureRepository: idempotent enqueue, locking, and failures', async () => {
    const idempotencyKey = `job-idem-${Date.now()}`;

    // Enqueue job 1
    const job1 = await jobRepo.enqueue(testTenant.id, {
      idempotencyKey,
      type: 'PROCESS_IMAGE',
      payload: { imageId: 'test-123' },
      maxAttempts: 3
    });
    expect(job1.status).toBe('queued');

    // Duplicate enqueue returns same job record (idempotency)
    const jobDuplicate = await jobRepo.enqueue(testTenant.id, {
      idempotencyKey,
      type: 'PROCESS_IMAGE',
      payload: { imageId: 'test-123' }
    });
    expect(jobDuplicate.id).toBe(job1.id);

    // Transition state: processing
    const processing = await jobRepo.markProcessing(testTenant.id, job1.id);
    expect(processing?.status).toBe('processing');
    expect(processing?.attempts).toBe(1);

    // Record failure in failure ledger
    const failure = await failureRepo.record(testTenant.id, {
      jobId: job1.id,
      attempt: 1,
      errorMessage: 'Simulated rate limit exhaustion (HTTP 429)',
      stackTrace: 'Error: Rate limit exceeded\n  at callProvider (...)'
    });
    expect(failure.attempt).toBe(1);

    const failureList = await failureRepo.listByJob(testTenant.id, job1.id);
    expect(failureList.length).toBe(1);

    // Complete job
    const completed = await jobRepo.markCompleted(testTenant.id, job1.id);
    expect(completed?.status).toBe('completed');
  });

  it('9. AICallRepository & BudgetEventRepository: tracks real costs and budget enforcement events', async () => {
    const opId = `op-job-${Date.now()}`;

    // Attempt 1 call
    const call1 = await aiCallRepo.record(testTenant.id, {
      callIdentity: `call-${Date.now()}-1`,
      operationId: opId,
      attempt: 1,
      provider: 'mock-gemini',
      model: 'gemini-1.5-flash',
      taskType: 'vision_metadata',
      inputTokens: 500,
      outputTokens: 120,
      totalTokens: 620,
      estimatedCostUsd: 0.00015,
      latencyMs: 340,
      status: 'success'
    });

    expect(call1.totalTokens).toBe(620);
    expect(call1.estimatedCostUsd).toBe(0.00015);

    // Attempt 2 call (Retry with its own real call identity)
    const call2 = await aiCallRepo.record(testTenant.id, {
      callIdentity: `call-${Date.now()}-2`,
      operationId: opId,
      attempt: 2,
      provider: 'mock-gemini',
      model: 'gemini-1.5-flash',
      taskType: 'vision_metadata',
      inputTokens: 520,
      outputTokens: 130,
      totalTokens: 650,
      estimatedCostUsd: 0.00016,
      latencyMs: 310,
      status: 'success'
    });

    expect(call2.totalTokens).toBe(650);

    // Check cumulative spend
    const cumulativeSpend = await aiCallRepo.getTenantCumulativeSpend(testTenant.id);
    expect(cumulativeSpend).toBeGreaterThanOrEqual(0.00031);

    // Record budget violation event
    const budgetEvent = await budgetEventRepo.record(testTenant.id, {
      attemptedAction: 'PROCESS_IMAGE',
      currentSpendUsd: 50.05,
      maxBudgetUsd: 50.0,
      message: 'Cumulative spend exceeded tenant budget limit ($50.0000)'
    });

    expect(budgetEvent.currentSpendUsd).toBe(50.05);

    const recentEvents = await budgetEventRepo.listRecent(testTenant.id, 5);
    expect(recentEvents.length).toBeGreaterThanOrEqual(1);
    expect(recentEvents[0]?.attemptedAction).toBe('PROCESS_IMAGE');
  });

  it('10. ImageIngestionTransaction: demonstrates atomic transaction-safe image + job creation', async () => {
    const url = `https://example.com/tx-ingest-${Date.now()}.jpg`;
    const result = await ingestionTx.execute(testTenant.id, url, 'snowy-fox.jpg');

    expect(result.image.id).toBeDefined();
    expect(result.image.url).toBe(url);
    expect(result.job.id).toBeDefined();
    expect(result.job.type).toBe('PROCESS_IMAGE');
    expect(result.job.payload.imageId).toBe(result.image.id);

    // Verify both exist in database
    const verifyImg = await imageRepo.findById(testTenant.id, result.image.id);
    const verifyJob = await jobRepo.findById(testTenant.id, result.job.id);

    expect(verifyImg).not.toBeNull();
    expect(verifyJob).not.toBeNull();
  });
});
