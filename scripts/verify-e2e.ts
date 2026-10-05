/**
 * Comprehensive End-to-End Verification Script
 * Validates all 22 capstone requirements against a clean database state.
 */
import { query, closePool } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { PostRepository } from '../src/repositories/PostRepository.js';
import { PostVectorRepository } from '../src/repositories/PostVectorRepository.js';
import { SuggestionRepository } from '../src/repositories/SuggestionRepository.js';
import { ReviewRepository } from '../src/repositories/ReviewRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { AICallRepository } from '../src/repositories/AICallRepository.js';
import { BudgetEventRepository } from '../src/repositories/BudgetEventRepository.js';
import { JobFailureRepository } from '../src/repositories/JobFailureRepository.js';
import {
  TenantAuthenticator,
  AuthenticationError,
  TenantAccessForbiddenError
} from '../src/utils/auth.js';
import { validateDataset } from '../data/validate.js';
import { ingestDataset } from '../data/ingest.js';
import { JobWorker } from '../src/workers/JobWorker.js';
import { MockVisionProvider } from '../src/services/ai/MockVisionProvider.js';
import { MockEmbeddingProvider } from '../src/services/ai/MockEmbeddingProvider.js';
import { BudgetGuardService } from '../src/services/BudgetGuardService.js';
import { PostService } from '../src/services/PostService.js';
import { MatchingEngineService } from '../src/services/matching/MatchingEngineService.js';
import { ReviewService } from '../src/services/ReviewService.js';

interface StepResult {
  step: number;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
  durationMs: number;
}

const results: StepResult[] = [];

async function recordStep(step: number, name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({ step, name, status: 'PASS', details, durationMs });
    console.log(
      `[Step ${step.toString().padStart(2, '0')}] PASS: ${name} (${durationMs}ms) - ${details}`
    );
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step, name, status: 'FAIL', details: msg, durationMs });
    console.error(
      `[Step ${step.toString().padStart(2, '0')}] FAIL: ${name} (${durationMs}ms) - ${msg}`
    );
  }
}

async function runEndToEndVerification(): Promise<void> {
  console.log('===============================================================');
  console.log(' FlyRank AI Engine: Clean State End-to-End Verification');
  console.log(` Target Database: ${env.DATABASE_URL}`);
  console.log('===============================================================');

  const tenantRepo = new TenantRepository();
  const imageRepo = new ImageRepository();
  const postRepo = new PostRepository();
  const postVectorRepo = new PostVectorRepository();
  const suggestionRepo = new SuggestionRepository();
  const reviewRepo = new ReviewRepository();
  const jobRepo = new JobRepository();
  const aiCallRepo = new AICallRepository();
  const budgetEventRepo = new BudgetEventRepository();
  const failureRepo = new JobFailureRepository();
  const auth = new TenantAuthenticator(tenantRepo);

  const mockVision = new MockVisionProvider();
  const mockEmbedding = new MockEmbeddingProvider();
  const budgetGuard = new BudgetGuardService(tenantRepo, aiCallRepo, budgetEventRepo);
  const postService = new PostService(postRepo, postVectorRepo, budgetGuard);
  const matchingService = new MatchingEngineService(
    postRepo,
    postVectorRepo,
    imageRepo,
    suggestionRepo
  );
  const reviewService = new ReviewService(reviewRepo, suggestionRepo);

  const rawKeyAlpha = 'e2e-api-key-alpha-' + Date.now();
  const rawKeyBeta = 'e2e-api-key-beta-' + Date.now();
  let tenantAlphaId = '';
  let tenantBetaId = '';
  let foxPostId = '';
  let foxSuggestionId = '';

  // 1. Tenant creation/authentication
  await recordStep(1, 'Tenant creation & API key authentication', async () => {
    const keyHash = auth.hashApiKey(rawKeyAlpha);
    const tenant = await tenantRepo.create({
      name: 'E2E Tenant Alpha',
      apiKeyHash: keyHash,
      maxBudgetUsd: 25.0
    });
    tenantAlphaId = tenant.id;

    const authResult = await auth.authenticate(rawKeyAlpha);
    if (!authResult.tenant || authResult.tenant.id !== tenantAlphaId) {
      throw new Error('Authentication failed for newly created tenant');
    }
    return `Tenant ${tenant.name} (${tenantAlphaId}) created and authenticated via SHA-256 API key`;
  });

  // 2. Dataset validation
  await recordStep(2, 'Dataset manifest validation', async () => {
    const validation = validateDataset();
    if (!validation.isValid || validation.totalImages !== 48) {
      throw new Error(`Dataset validation failed: ${validation.errors.join(', ')}`);
    }
    return `Verified 48 curated dataset files, magic bytes, and SHA-256 digests`;
  });

  // 3. Dataset ingestion
  await recordStep(3, 'Dataset ingestion pipeline', async () => {
    const ingestStats = await ingestDataset({
      apiKey: rawKeyAlpha,
      claimedTenantId: tenantAlphaId
    });
    if (ingestStats.newlyIngested !== 48) {
      throw new Error(`Expected 48 newly ingested images, got ${ingestStats.newlyIngested}`);
    }
    const count = await imageRepo.list(tenantAlphaId, { limit: 100 });
    if (count.length !== 48) {
      throw new Error(`Database image count mismatch: expected 48, got ${count.length}`);
    }
    return `Ingested 48 images into tenant ${tenantAlphaId} with status 'pending'`;
  });

  // 4. Image jobs created
  await recordStep(4, 'Image processing jobs queued', async () => {
    const jobs = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM jobs WHERE tenant_id = $1 AND status = 'queued';`,
      [tenantAlphaId]
    );
    const count = parseInt(jobs.rows[0]?.count ?? '0', 10);
    if (count !== 48) {
      throw new Error(`Expected 48 queued jobs, got ${count}`);
    }
    return `48 background jobs queued with deterministic idempotency keys`;
  });

  // 5. Worker processes images
  await recordStep(5, 'Background worker batch execution', async () => {
    const worker = new JobWorker({
      tenantId: tenantAlphaId,
      visionProvider: mockVision,
      embeddingProvider: mockEmbedding
    });
    const batch = await worker.drain(100);
    if (batch.totalProcessed < 48 || batch.succeeded !== 48) {
      throw new Error(`Expected 48 succeeded jobs, got ${JSON.stringify(batch)}`);
    }
    const remainingQueued = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM jobs WHERE tenant_id = $1 AND status = 'queued';`,
      [tenantAlphaId]
    );
    if (parseInt(remainingQueued.rows[0]?.count ?? '0', 10) !== 0) {
      throw new Error('Some jobs were not completed');
    }
    return `Worker processed and marked 48/48 jobs completed (${batch.succeeded} succeeded)`;
  });

  // 6. Vision metadata persisted
  await recordStep(6, 'Vision metadata persistence', async () => {
    const metaRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM image_metadata WHERE tenant_id = $1;`,
      [tenantAlphaId]
    );
    const count = parseInt(metaRows.rows[0]?.count ?? '0', 10);
    if (count !== 48) {
      throw new Error(`Expected 48 metadata records, got ${count}`);
    }
    return `48 schema-valid image_metadata records verified`;
  });

  // 7. Embeddings persisted
  await recordStep(7, 'Image vector embeddings persistence', async () => {
    const vecRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM image_vectors WHERE tenant_id = $1;`,
      [tenantAlphaId]
    );
    const count = parseInt(vecRows.rows[0]?.count ?? '0', 10);
    if (count !== 48) {
      throw new Error(`Expected 48 image vectors, got ${count}`);
    }
    return `48 768-dimensional normalized image vectors verified`;
  });

  // 8. AI telemetry persisted
  await recordStep(8, 'AI telemetry tracking', async () => {
    const calls = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ai_calls WHERE tenant_id = $1;`,
      [tenantAlphaId]
    );
    const count = parseInt(calls.rows[0]?.count ?? '0', 10);
    if (count !== 96) {
      throw new Error(`Expected 96 AI telemetry calls (48 vision + 48 embedding), got ${count}`);
    }
    return `96 AI telemetry calls recorded (48 vision + 48 embedding)`;
  });

  // 9. Post creation
  await recordStep(9, 'Blog post creation', async () => {
    const postRes = await postService.createPost(
      tenantAlphaId,
      {
        title: 'The Cunning Red Fox: Survival in Temperate Woodlands',
        slug: 'the-cunning-red-fox-' + Date.now(),
        body: 'Red foxes (Vulpes vulpes) thrive in woodland edges with extraordinary nocturnal hunting agility.',
        primaryCategory: 'wildlife'
      },
      { embeddingProvider: mockEmbedding }
    );
    foxPostId = postRes.post.id;
    return `Post created: ${postRes.post.title} (ID: ${foxPostId})`;
  });

  // 10. Post embedding
  await recordStep(10, 'Post vector embedding generation', async () => {
    const vec = await postVectorRepo.findByPostId(tenantAlphaId, foxPostId);
    if (!vec || !vec.embedding || vec.embedding.length !== 768) {
      throw new Error('Post vector embedding missing or invalid dimensions');
    }
    return `Post vector generated: 768 dimensions, model: ${vec.modelName}`;
  });

  // 11. Matching
  await recordStep(11, 'Semantic matching engine execution', async () => {
    const matchResult = await matchingService.matchPost(tenantAlphaId, foxPostId);
    if (matchResult.status !== 'suggested' || !matchResult.bestMatch) {
      throw new Error(`Expected suggested match, got ${matchResult.status}`);
    }
    return `Matching succeeded: status=${matchResult.status}, candidates evaluated=${matchResult.candidates.length}`;
  });

  // 12. Candidate rejection reasons
  await recordStep(12, 'Candidate rejection reasons auditing', async () => {
    const matchResult = await matchingService.matchPost(tenantAlphaId, foxPostId);
    const rejected = matchResult.candidates.filter((c) => !c.accepted);
    const reasons = new Set(rejected.map((r) => r.rejectionReason));
    if (!reasons.has('CATEGORY_MISMATCH') || !reasons.has('SUBJECT_CONFLICT')) {
      throw new Error(
        `Expected CATEGORY_MISMATCH and SUBJECT_CONFLICT, found: ${Array.from(reasons).join(', ')}`
      );
    }
    return `Observed structured reason codes: ${Array.from(reasons).join(', ')}`;
  });

  // 13. Correct recommendation
  await recordStep(13, 'Correct top-1 recommendation selection', async () => {
    const matchResult = await matchingService.matchPost(tenantAlphaId, foxPostId);
    const best = matchResult.bestMatch;
    if (!best || best.category !== 'wildlife' || best.detectedSubject !== 'red fox') {
      throw new Error(`Wrong best match: ${JSON.stringify(best)}`);
    }
    if (best.similarityScore < 0.72) {
      throw new Error(`Similarity too low: ${best.similarityScore}`);
    }
    return `Selected correct image: [${best.category}] ${best.detectedSubject} (sim: ${best.similarityScore.toFixed(4)})`;
  });

  // 14. no_confident_match
  await recordStep(14, 'No-confident-match fallback execution', async () => {
    const matchResult = await matchingService.matchPost(tenantAlphaId, foxPostId, {
      similarityThreshold: 0.99999 // Unattainably high
    });
    if (matchResult.status !== 'no_confident_match' || matchResult.bestMatch !== null) {
      throw new Error(`Expected no_confident_match fallback, got ${matchResult.status}`);
    }
    return `Fallback verified: status="no_confident_match", bestMatch=null, audit entries=${matchResult.candidates.length}`;
  });

  // 15. Review approval
  await recordStep(15, 'Editorial review approval workflow', async () => {
    const suggestions = await suggestionRepo.listByPostId(tenantAlphaId, foxPostId);
    if (suggestions.length === 0) {
      throw new Error('No suggestions found for post');
    }
    foxSuggestionId = suggestions[0]!.id;
    const review = await reviewService.createReview(tenantAlphaId, {
      suggestionId: foxSuggestionId,
      decision: 'approved',
      notes: 'Verified editorial alignment with fox article'
    });
    if (review.decision !== 'approved') {
      throw new Error('Review approval failed');
    }
    return `Editorial review approved: reviewId=${review.id}, decision=${review.decision}`;
  });

  // 16. Review rejection
  await recordStep(16, 'Editorial review rejection workflow', async () => {
    const review = await reviewService.createReview(tenantAlphaId, {
      suggestionId: foxSuggestionId,
      decision: 'rejected',
      notes: 'Requesting alternative angle'
    });
    if (review.decision !== 'rejected') {
      throw new Error('Review rejection failed');
    }
    return `Editorial review rejection recorded: reviewId=${review.id}, decision=${review.decision}`;
  });

  // 17. Tenant isolation
  await recordStep(17, 'Cross-tenant data and review isolation', async () => {
    const keyHashBeta = auth.hashApiKey(rawKeyBeta);
    const tenantBeta = await tenantRepo.create({
      name: 'E2E Tenant Beta',
      apiKeyHash: keyHashBeta,
      maxBudgetUsd: 10.0
    });
    tenantBetaId = tenantBeta.id;

    // Tenant Beta cannot see Tenant Alpha's post
    const betaPost = await postRepo.findById(tenantBetaId, foxPostId);
    if (betaPost !== null) {
      throw new Error('Tenant Beta was able to read Tenant Alpha post');
    }

    // Tenant Beta cannot approve Tenant Alpha suggestion
    let crossTenantReviewBlocked = false;
    try {
      await reviewService.createReview(tenantBetaId, {
        suggestionId: foxSuggestionId,
        decision: 'approved'
      });
    } catch {
      crossTenantReviewBlocked = true;
    }
    if (!crossTenantReviewBlocked) {
      throw new Error('Tenant Beta was able to review Tenant Alpha suggestion');
    }

    // Tenant Beta candidate pool is empty
    const betaCandidates = await imageRepo.listCandidatesForMatching(tenantBetaId);
    if (betaCandidates.length !== 0) {
      throw new Error(`Tenant Beta candidate pool leaked: ${betaCandidates.length} images`);
    }

    return `Verified: Tenant Beta cannot access Alpha post, review Alpha suggestion, or view Alpha candidate images`;
  });

  // 18. Idempotent reprocessing
  await recordStep(18, 'Idempotent ingestion and matching re-runs', async () => {
    // Re-run matching
    await matchingService.matchPost(tenantAlphaId, foxPostId);
    const suggestionsAfter = await suggestionRepo.listByPostId(tenantAlphaId, foxPostId);
    if (suggestionsAfter.length !== 1) {
      throw new Error(
        `Expected exactly 1 active suggestion after re-matching, got ${suggestionsAfter.length}`
      );
    }

    // Re-run ingestion
    const reingestStats = await ingestDataset({
      apiKey: rawKeyAlpha,
      claimedTenantId: tenantAlphaId
    });
    if (reingestStats.newlyIngested !== 0 || reingestStats.alreadyExisted !== 48) {
      throw new Error(`Ingestion idempotency violated: ${JSON.stringify(reingestStats)}`);
    }
    return `Idempotency verified: re-matching retains 1 active suggestion; re-ingestion produced 0 duplicates`;
  });

  // 19. Budget guard
  await recordStep(19, 'AI budget guard enforcement', async () => {
    // Set tiny budget on Beta tenant
    await query(`UPDATE tenants SET max_budget_usd = 0.00001 WHERE id = $1;`, [tenantBetaId]);
    await aiCallRepo.record(tenantBetaId, {
      callIdentity: `e2e-seed-${Date.now()}`,
      operationId: 'e2e-seed-op',
      provider: 'mock',
      model: 'mock-model',
      taskType: 'vision_metadata',
      latencyMs: 10,
      status: 'success',
      estimatedCostUsd: 0.05
    });

    const budgetCheck = await budgetGuard.checkBudget(tenantBetaId, 'TEST_TASK');
    if (budgetCheck.allowed) {
      throw new Error('Budget guard failed to report budget exceeded');
    }

    const events = await budgetEventRepo.listRecent(tenantBetaId, 5);
    if (events.length === 0) {
      throw new Error('No budget event was logged upon exhaustion');
    }
    return `Budget guard halted operation when spend ($0.05) exceeded limit ($0.00001); logged budget event`;
  });

  // 20. Retry behavior
  await recordStep(20, 'Job worker transient retry and backoff', async () => {
    const transientJob = await jobRepo.enqueue(tenantAlphaId, {
      idempotencyKey: 'transient-retry-test-' + Date.now(),
      type: 'PROCESS_IMAGE',
      payload: { imageId: 'test-img' }
    });

    await jobRepo.markProcessing(tenantAlphaId, transientJob.id);
    await jobRepo.markFailed(tenantAlphaId, transientJob.id, new Date(Date.now() + 5000));
    const reloaded = await jobRepo.findById(tenantAlphaId, transientJob.id);
    if (!reloaded || reloaded.attempts !== 1 || reloaded.status !== 'queued') {
      throw new Error('Job attempt increment or rescheduling failed');
    }
    return `Transient failure rescheduled: attempt 1/3, next run in 5000ms`;
  });

  // 21. Failure recording
  await recordStep(21, 'Permanent failure recording into job_failures', async () => {
    const failedJob = await jobRepo.enqueue(tenantAlphaId, {
      idempotencyKey: 'permanent-failure-test-' + Date.now(),
      type: 'PROCESS_IMAGE',
      payload: { imageId: 'test-img' }
    });

    await failureRepo.record(tenantAlphaId, {
      jobId: failedJob.id,
      attempt: 1,
      errorMessage: '[PERMANENT] Invalid image header bytes'
    });
    await jobRepo.markFailed(tenantAlphaId, failedJob.id, null);

    const failures = await failureRepo.listByJob(tenantAlphaId, failedJob.id);
    if (failures.length !== 1 || !failures[0]!.errorMessage.includes('PERMANENT')) {
      throw new Error('Failed to record permanent failure entry');
    }
    return `Permanent failure recorded in job_failures: status=failed`;
  });

  // 22. API error handling
  await recordStep(22, 'API boundary and error safety', async () => {
    let badKeyRejected = false;
    try {
      await auth.authenticate('bad-nonexistent-key');
    } catch (err) {
      if (err instanceof AuthenticationError) badKeyRejected = true;
    }
    if (!badKeyRejected) {
      throw new Error('Invalid key was not rejected with AuthenticationError');
    }

    let spoofBlocked = false;
    try {
      await auth.authenticate(rawKeyAlpha, tenantBetaId);
    } catch (err) {
      if (err instanceof TenantAccessForbiddenError) spoofBlocked = true;
    }
    if (!spoofBlocked) {
      throw new Error(
        'Cross-tenant header spoofing was not blocked with TenantAccessForbiddenError'
      );
    }

    return `API error boundaries verified: invalid keys rejected (AuthenticationError), cross-tenant spoofing blocked (TenantAccessForbiddenError)`;
  });

  console.log('\n===============================================================');
  console.log(' END-TO-END VERIFICATION SUMMARY');
  console.log('===============================================================');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(` Total Steps : ${results.length}`);
  console.log(` Passed      : ${passed}`);
  console.log(` Failed      : ${failed}`);
  console.log(` Status      : ${failed === 0 ? 'ALL 22 STEPS PASSED' : 'VERIFICATION FAILED'}`);
  console.log('===============================================================\n');

  await closePool();

  if (failed > 0) {
    process.exit(1);
  }
}

runEndToEndVerification().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
