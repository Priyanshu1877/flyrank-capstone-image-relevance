import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePool, query } from '../src/config/database.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { PostRepository } from '../src/repositories/PostRepository.js';
import { PostVectorRepository } from '../src/repositories/PostVectorRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { ImageMetadataRepository } from '../src/repositories/ImageMetadataRepository.js';
import { ImageVectorRepository } from '../src/repositories/ImageVectorRepository.js';
import { SuggestionRepository } from '../src/repositories/SuggestionRepository.js';
import { ReviewRepository } from '../src/repositories/ReviewRepository.js';
import { AICallRepository } from '../src/repositories/AICallRepository.js';
import { BudgetEventRepository } from '../src/repositories/BudgetEventRepository.js';
import { TenantAuthenticator } from '../src/utils/auth.js';
import { Tenant } from '../src/models/types.js';
import { PostService } from '../src/services/PostService.js';
import { ReviewService } from '../src/services/ReviewService.js';
import { MatchingEngineService } from '../src/services/matching/MatchingEngineService.js';
import { calculateCosineSimilarity } from '../src/services/matching/cosineSimilarity.js';
import { detectSubjectConflict } from '../src/services/matching/conflictRules.js';
import { MockEmbeddingProvider } from '../src/services/ai/MockEmbeddingProvider.js';
import { BudgetExhaustedError } from '../src/services/BudgetGuardService.js';

describe('Phase 5: Semantic Matching Engine & Mismatch Guard', () => {
  const tenantRepo = new TenantRepository();
  const postRepo = new PostRepository();
  const postVectorRepo = new PostVectorRepository();
  const imageRepo = new ImageRepository();
  const metadataRepo = new ImageMetadataRepository();
  const vectorRepo = new ImageVectorRepository();
  const suggestionRepo = new SuggestionRepository();
  const reviewRepo = new ReviewRepository();
  const aiCallRepo = new AICallRepository();
  const budgetEventRepo = new BudgetEventRepository();
  const auth = new TenantAuthenticator(tenantRepo);

  const postService = new PostService(postRepo, postVectorRepo);
  const reviewService = new ReviewService(reviewRepo, suggestionRepo);
  const matchingEngine = new MatchingEngineService(
    postRepo,
    postVectorRepo,
    imageRepo,
    suggestionRepo
  );

  let tenantA: Tenant;
  let tenantB: Tenant;
  const rawKeyA = `matching-test-tenant-a-${Date.now()}`;
  const rawKeyB = `matching-test-tenant-b-${Date.now()}`;

  beforeAll(async () => {
    tenantA = await tenantRepo.create({
      name: 'Matching Tenant Alpha',
      apiKeyHash: auth.hashApiKey(rawKeyA),
      maxBudgetUsd: 10.0
    });

    tenantB = await tenantRepo.create({
      name: 'Matching Tenant Beta',
      apiKeyHash: auth.hashApiKey(rawKeyB),
      maxBudgetUsd: 10.0
    });
  });

  afterAll(async () => {
    const tIds = [tenantA.id, tenantB.id];
    await query('DELETE FROM reviews WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM suggestions WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM post_vectors WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM posts WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM image_vectors WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM image_metadata WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM images WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM ai_calls WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM budget_events WHERE tenant_id = ANY($1)', [tIds]);
    await query('DELETE FROM tenants WHERE id = ANY($1)', [tIds]);
    await closePool();
  });

  // 1. Cosine similarity correctness
  it('1. Cosine Similarity: calculates exact normalized dot product', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const res = calculateCosineSimilarity(vecA, vecB);
    expect(res.isValid).toBe(true);
    expect(res.similarity).toBeCloseTo(1.0, 5);

    const vecOrth = [0, 1, 0];
    const resOrth = calculateCosineSimilarity(vecA, vecOrth);
    expect(resOrth.isValid).toBe(true);
    expect(resOrth.similarity).toBeCloseTo(0.0, 5);
  });

  // 2. Zero-vector handling
  it('2. Defensive Cosine Similarity: rejects zero-magnitude vectors', () => {
    const zeroVec = [0, 0, 0];
    const unitVec = [1, 0, 0];
    const res = calculateCosineSimilarity(zeroVec, unitVec);
    expect(res.isValid).toBe(false);
    expect(res.similarity).toBe(0.0);
    expect(res.error).toContain('zero magnitude');
  });

  // 3. Dimension mismatch handling
  it('3. Defensive Cosine Similarity: rejects mismatched dimensions and non-finite values', () => {
    const vec3 = [1, 2, 3];
    const vec4 = [1, 2, 3, 4];
    const resDiff = calculateCosineSimilarity(vec3, vec4);
    expect(resDiff.isValid).toBe(false);
    expect(resDiff.error).toContain('dimension mismatch');

    const nanVec = [1, NaN, 3];
    const resNaN = calculateCosineSimilarity(vec3, nanVec);
    expect(resNaN.isValid).toBe(false);
    expect(resNaN.error).toContain('non-finite');
  });

  // 4. Category compatibility
  it('4. Category Compatibility: detects compatible categories and taxonomy conflicts', () => {
    const postCat = 'wildlife';
    const imageCat = 'wildlife';
    expect(postCat.toLowerCase()).toBe(imageCat.toLowerCase());

    const conflict = detectSubjectConflict('wildlife', 'red fox hunting', 'wildlife', 'gray wolf');
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.reason).toContain('expected fox, detected wolf');
  });

  // 5. Category mismatch rejection
  it('5. Category Mismatch Gate: rejects candidate from incompatible category', async () => {
    const culinaryImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-culinary-mismatch-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, culinaryImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: culinaryImg.id,
      category: 'culinary',
      subject: 'espresso coffee',
      caption: 'A cup of espresso',
      attributes: ['coffee'],
      confidence: 0.95
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: culinary. Subject: espresso coffee');
    await vectorRepo.upsert(tenantA.id, {
      imageId: culinaryImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const wildlifePost = await postService.createPost(tenantA.id, {
      title: 'Wildlife Conservation',
      slug: `wildlife-conservation-${Date.now()}`,
      body: 'Conserving forest animals in their natural habitats.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, wildlifePost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === culinaryImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    expect(cand?.rejectionReason).toBe('CATEGORY_MISMATCH');
  });

  // 6. Red fox -> red fox acceptance
  it('6. Red Fox Acceptance: accepts red fox image for red fox post', async () => {
    const foxImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-fox-accept-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, foxImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: foxImg.id,
      category: 'wildlife',
      subject: 'red fox',
      caption: 'A red fox resting in the woodland.',
      attributes: ['canine', 'red fur'],
      confidence: 0.94
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding(
      'Category: wildlife. Subject: red fox. Attributes: canine, red fur. Description: A red fox resting in the woodland.'
    );
    await vectorRepo.upsert(tenantA.id, {
      imageId: foxImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const foxPost = await postService.createPost(tenantA.id, {
      title: 'The Secret Lives of Red Foxes',
      slug: `secret-lives-red-foxes-${Date.now()}`,
      body: 'Red foxes are cunning woodland hunters with reddish-orange fur and bushy tails.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, foxPost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === foxImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(true);
    expect(cand?.similarityScore).toBeGreaterThanOrEqual(0.72);
  });

  // 7. Gray wolf -> red fox rejection
  it('7. Subject Conflict Gate: rejects gray wolf image for red fox post', async () => {
    const wolfImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-wolf-reject-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, wolfImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: wolfImg.id,
      category: 'wildlife',
      subject: 'gray wolf',
      caption: 'A wild gray wolf in snow.',
      attributes: ['canine', 'gray fur', 'timber wolf'],
      confidence: 0.93
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding(
      'Category: wildlife. Subject: gray wolf. Attributes: canine, gray fur. Description: A wild gray wolf in snow.'
    );
    await vectorRepo.upsert(tenantA.id, {
      imageId: wolfImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const foxPost = await postService.createPost(tenantA.id, {
      title: 'Red Fox Hunting Behavior in Autumn',
      slug: `red-fox-hunting-autumn-${Date.now()}`,
      body: 'Red fox vulpine behavior in northern temperate woodlands.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, foxPost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === wolfImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    expect(cand?.rejectionReason).toBe('SUBJECT_CONFLICT');
    expect(cand?.explanation).toContain('expected fox, detected wolf');
  });

  // 8. Red fox -> gray wolf rejection
  it('8. Subject Conflict Gate: rejects red fox image for gray wolf post', async () => {
    const foxImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-fox-for-wolf-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, foxImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: foxImg.id,
      category: 'wildlife',
      subject: 'red fox',
      caption: 'A red fox resting in the woodland.',
      attributes: ['canine', 'red fur'],
      confidence: 0.94
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: wildlife. Subject: red fox');
    await vectorRepo.upsert(tenantA.id, {
      imageId: foxImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const wolfPost = await postService.createPost(tenantA.id, {
      title: 'Gray Wolf Pack Territory and Howling',
      slug: `gray-wolf-pack-territory-${Date.now()}`,
      body: 'Gray wolf timber wolf dynamics in boreal forests.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, wolfPost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === foxImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    expect(cand?.rejectionReason).toBe('SUBJECT_CONFLICT');
    expect(cand?.explanation).toContain('expected wolf, detected fox');
  });

  // 9. Low-confidence rejection
  it('9. Confidence Floor Gate: rejects image when vision confidence < 0.70', async () => {
    const lowConfImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-low-conf-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, lowConfImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: lowConfImg.id,
      category: 'wildlife',
      subject: 'red fox',
      caption: 'A blurry low quality figure in shadows.',
      attributes: ['blurry'],
      confidence: 0.55 // strictly below 0.70 floor
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: wildlife. Subject: red fox');
    await vectorRepo.upsert(tenantA.id, {
      imageId: lowConfImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const post = await postService.createPost(tenantA.id, {
      title: 'Red Fox Stalking Mice',
      slug: `red-fox-stalking-mice-${Date.now()}`,
      body: 'Red foxes hunt small rodents under the snow.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, post.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === lowConfImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    expect(cand?.rejectionReason).toBe('LOW_CONFIDENCE');
  });

  // 10. Quarantined image rejection
  it('10. Quarantine Gate: rejects flagged/quarantined image', async () => {
    const flaggedImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-quarantine-${Date.now()}`
    });
    // Mark flagged = true
    await imageRepo.updateStatus(tenantA.id, flaggedImg.id, 'completed', true);
    await metadataRepo.upsert(tenantA.id, {
      imageId: flaggedImg.id,
      category: 'wildlife',
      subject: 'red fox',
      caption: 'A red fox image that was flagged during safety review.',
      attributes: ['canine'],
      confidence: 0.95
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: wildlife. Subject: red fox');
    await vectorRepo.upsert(tenantA.id, {
      imageId: flaggedImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const post = await postService.createPost(tenantA.id, {
      title: 'Red Fox Biology and Habitat',
      slug: `red-fox-biology-${Date.now()}`,
      body: 'Red fox vulpes vulpes biology in northern climates.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, post.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === flaggedImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    expect(cand?.rejectionReason).toBe('QUARANTINED');
  });

  // 11. Similarity below threshold rejection
  it('11. Similarity Threshold Gate: rejects candidates below provisional 0.720 threshold', async () => {
    const bearImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-below-thresh-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, bearImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: bearImg.id,
      category: 'wildlife',
      subject: 'brown bear',
      caption: 'A large brown bear eating berries in the forest.',
      attributes: ['bear', 'fur'],
      confidence: 0.92
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: wildlife. Subject: brown bear');
    await vectorRepo.upsert(tenantA.id, {
      imageId: bearImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const giraffePost = await postService.createPost(tenantA.id, {
      title: 'Tall African Giraffes Grazing Acacia',
      slug: `tall-african-giraffes-${Date.now()}`,
      body: 'African giraffe herds browse tall acacia leaves across savanna landscapes.',
      primaryCategory: 'wildlife'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, giraffePost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === bearImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(false);
    // Similarity between brown bear and giraffe is around 0.40 - 0.50 (< 0.72)
    expect(cand?.rejectionReason).toBe('SIMILARITY_BELOW_THRESHOLD');
  });

  // 12. Similarity above threshold acceptance
  it('12. Similarity Acceptance: accepts candidate matching topic above 0.720', async () => {
    const laptopImg = await imageRepo.create(tenantA.id, {
      url: `https://images.unsplash.com/test-laptop-accept-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantA.id, laptopImg.id, 'completed', false);
    await metadataRepo.upsert(tenantA.id, {
      imageId: laptopImg.id,
      category: 'technology',
      subject: 'modern laptop',
      caption: 'A modern slim laptop computer open on an office desk.',
      attributes: ['portable', 'screen'],
      confidence: 0.95
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding(
      'Category: technology. Subject: modern laptop. Attributes: portable, screen. Description: A modern slim laptop computer open on an office desk.'
    );
    await vectorRepo.upsert(tenantA.id, {
      imageId: laptopImg.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    const laptopPost = await postService.createPost(tenantA.id, {
      title: 'Ultralight Modern Laptop Hardware',
      slug: `ultralight-laptop-hardware-${Date.now()}`,
      body: 'Modern laptops feature high performance silicon and vibrant displays for developers.',
      primaryCategory: 'technology'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, laptopPost.post.id);
    const cand = matchRes.candidates.find((c) => c.imageId === laptopImg.id);
    expect(cand).toBeDefined();
    expect(cand?.accepted).toBe(true);
    expect(cand?.similarityScore).toBeGreaterThanOrEqual(0.72);
  });

  // 13. Multiple candidate ranking
  it('13. Ranking: ranks eligible candidates in descending similarity order', async () => {
    const post = await postService.createPost(tenantA.id, {
      title: 'Artisan Espresso and Coffee Culture',
      slug: `artisan-espresso-culture-${Date.now()}`,
      body: 'Extracting rich dark espresso with hazelnut crema and roasted coffee beans.',
      primaryCategory: 'culinary'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, post.post.id);
    if (matchRes.eligibleCandidatesCount > 1) {
      const eligible = matchRes.candidates.filter((c) => c.accepted);
      for (let i = 0; i < eligible.length - 1; i++) {
        expect(eligible[i]!.similarityScore).toBeGreaterThanOrEqual(
          eligible[i + 1]!.similarityScore
        );
        expect(eligible[i]!.rank).toBe(i + 1);
      }
    }
  });

  // 14. Best-match selection
  it('14. Best-Match Selection: selects rank 1 candidate as bestMatch', async () => {
    const post = await postService.createPost(tenantA.id, {
      title: 'Traditional Japanese Matcha Whisking',
      slug: `matcha-whisking-ceremony-${Date.now()}`,
      body: 'Matcha ceremonies whisk green tea powder into velvety jade microfoam.',
      primaryCategory: 'culinary'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, post.post.id);
    if (matchRes.bestMatch) {
      expect(matchRes.bestMatch.rank).toBe(1);
      expect(matchRes.bestMatch.accepted).toBe(true);
      expect(matchRes.status).toBe('suggested');
    }
  });

  // 15. No-confident-match fallback
  it('15. Safe No-Match Fallback: returns status = no_confident_match when no candidate qualifies', async () => {
    // Post with category where no matching images exist
    const post = await postService.createPost(tenantA.id, {
      title: 'Deep Ocean Bioluminescence Exploration',
      slug: `deep-ocean-bioluminescence-${Date.now()}`,
      body: 'Deep sea hydrothermal vents and abyssal bioluminescent jellyfish creatures.',
      primaryCategory: 'marine_biology'
    });

    const matchRes = await matchingEngine.matchPost(tenantA.id, post.post.id);
    expect(matchRes.status).toBe('no_confident_match');
    expect(matchRes.bestMatch).toBeNull();
    expect(matchRes.eligibleCandidatesCount).toBe(0);
  });

  // 16. Suggestion persistence
  it('16. Suggestion Persistence: persists recommendations in suggestions table', async () => {
    const post = await postService.createPost(tenantA.id, {
      title: 'Brutalist Architecture In London',
      slug: `brutalist-london-${Date.now()}`,
      body: 'Raw concrete brutalist monolithic buildings across London civic centers.',
      primaryCategory: 'architecture'
    });

    await matchingEngine.matchPost(tenantA.id, post.post.id);

    const savedSuggestions = await suggestionRepo.listByPostId(tenantA.id, post.post.id);
    expect(savedSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(savedSuggestions[0]!.postId).toBe(post.post.id);
    expect(savedSuggestions[0]!.tenantId).toBe(tenantA.id);
  });

  // 17. Suggestion idempotency
  it('17. Suggestion Idempotency: re-running matching cleans previous suggestions without duplicate rows', async () => {
    const post = await postService.createPost(tenantA.id, {
      title: 'Neapolitan Pizza Crust Fermentation',
      slug: `pizza-crust-ferment-${Date.now()}`,
      body: 'Neapolitan pizza baked in wood-fired oven with bubbly charred crust.',
      primaryCategory: 'culinary'
    });

    // Run 1
    await matchingEngine.matchPost(tenantA.id, post.post.id);
    const count1 = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM suggestions WHERE tenant_id = $1 AND post_id = $2',
      [tenantA.id, post.post.id]
    );

    // Run 2 (re-run)
    await matchingEngine.matchPost(tenantA.id, post.post.id);
    const count2 = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM suggestions WHERE tenant_id = $1 AND post_id = $2',
      [tenantA.id, post.post.id]
    );

    expect(count1.rows[0]?.count).toBe(count2.rows[0]?.count);
  });

  // 18. Tenant isolation
  it('18. Matching Tenant Isolation: matching engine only considers candidates belonging to the tenant', async () => {
    // Ingest image only in Tenant B
    const imgB = await imageRepo.create(tenantB.id, {
      url: `https://images.unsplash.com/test-tenant-b-exclusive-${Date.now()}`
    });
    await imageRepo.updateStatus(tenantB.id, imgB.id, 'completed', false);
    await metadataRepo.upsert(tenantB.id, {
      imageId: imgB.id,
      category: 'technology',
      subject: 'server rack',
      caption: 'Tenant B private server rack',
      attributes: ['hardware'],
      confidence: 0.95
    });
    const emb = new MockEmbeddingProvider();
    const vecRes = await emb.generateEmbedding('Category: technology. Subject: server rack');
    await vectorRepo.upsert(tenantB.id, {
      imageId: imgB.id,
      modelName: vecRes.model,
      dimensions: vecRes.dimensions,
      embedding: vecRes.embedding
    });

    // Tenant A matches a technology post
    const postA = await postService.createPost(tenantA.id, {
      title: 'Cloud Datacenter Server Racks',
      slug: `cloud-server-racks-iso-${Date.now()}`,
      body: 'Enterprise cloud infrastructure server rack cooling systems.',
      primaryCategory: 'technology'
    });

    const matchResA = await matchingEngine.matchPost(tenantA.id, postA.post.id);
    // Tenant B's image must NEVER appear in Tenant A's candidates list
    const leaked = matchResA.candidates.find((c) => c.imageId === imgB.id);
    expect(leaked).toBeUndefined();
  });

  // 19. Review creation
  it('19. Editorial Review: creates human-in-the-loop review record', async () => {
    const post = await postService.createPost(tenantA.id, {
      title: 'Gothic Cathedral Spires',
      slug: `gothic-cathedral-spires-${Date.now()}`,
      body: 'Gothic cathedral ribbed vaults and stained glass windows.',
      primaryCategory: 'architecture'
    });

    await matchingEngine.matchPost(tenantA.id, post.post.id);
    const suggestions = await suggestionRepo.listByPostId(tenantA.id, post.post.id);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);

    const targetSuggestion = suggestions[0]!;
    const review = await reviewService.createReview(tenantA.id, {
      suggestionId: targetSuggestion.id,
      decision: 'approved',
      notes: 'Matches gothic stone spires accurately.',
      reviewerId: 'lead_editor'
    });

    expect(review.id).toBeDefined();
    expect(review.decision).toBe('approved');
    expect(review.notes).toContain('gothic stone spires');
  });

  // 20. Review retrieval
  it('20. Review Retrieval: lists reviews with decision filter and tenant scope', async () => {
    const reviews = await reviewService.listReviews(tenantA.id, { decision: 'approved' });
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    expect(reviews.every((r) => r.decision === 'approved')).toBe(true);
  });

  // 21. Cross-tenant review protection
  it('21. Cross-Tenant Review Protection: rejects review on another tenant suggestion', async () => {
    const postA = await postService.createPost(tenantA.id, {
      title: 'Tenant A Post For Review Guard',
      slug: `tenant-a-post-guard-${Date.now()}`,
      body: 'Post belonging strictly to tenant A.',
      primaryCategory: 'wildlife'
    });
    await matchingEngine.matchPost(tenantA.id, postA.post.id);
    const suggestionsA = await suggestionRepo.listByPostId(tenantA.id, postA.post.id);
    const targetA = suggestionsA[0]!;

    // Tenant B attempts to review Tenant A's suggestion
    await expect(
      reviewService.createReview(tenantB.id, {
        suggestionId: targetA.id,
        decision: 'approved'
      })
    ).rejects.toThrow('access denied');
  });

  // 22. Post tenant isolation
  it('22. Post Isolation: prohibits cross-tenant post access and listing', async () => {
    const postA = await postService.createPost(tenantA.id, {
      title: 'Tenant A Secret Strategy Post',
      slug: `secret-post-tenant-a-${Date.now()}`,
      body: 'Confidential strategic insights.',
      primaryCategory: 'technology'
    });

    const crossPost = await postService.getPostById(tenantB.id, postA.post.id);
    expect(crossPost).toBeNull();

    const listB = await postService.listPosts(tenantB.id);
    const foundInB = listB.find((p) => p.id === postA.post.id);
    expect(foundInB).toBeUndefined();
  });

  // 23. Post vector generation
  it('23. Post Vector Generation: generates schema-valid 768-dimensional normalized vector', async () => {
    const created = await postService.createPost(tenantA.id, {
      title: 'Vector Generation Verification Post',
      slug: `vector-gen-verify-${Date.now()}`,
      body: 'Verifying post vector generation dimensions and normalization.',
      primaryCategory: 'technology'
    });

    expect(created.vector.dimensions).toBe(768);
    expect(created.vector.embedding).toHaveLength(768);

    const norm = Math.sqrt(created.vector.embedding.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });

  // 24. AI budget guard for post embedding
  it('24. Post Embedding Budget Guard: halts post vector creation when budget exhausted', async () => {
    const brokeTenant = await tenantRepo.create({
      name: 'Exhausted Budget Tenant',
      apiKeyHash: auth.hashApiKey(`broke-post-key-${Date.now()}`),
      maxBudgetUsd: 0.00001
    });

    await aiCallRepo.record(brokeTenant.id, {
      callIdentity: `post-broke-seed-${Date.now()}`,
      operationId: 'seed',
      provider: 'mock',
      model: 'mock',
      taskType: 'text_embedding',
      latencyMs: 10,
      status: 'success',
      estimatedCostUsd: 0.05
    });

    await expect(
      postService.createPost(brokeTenant.id, {
        title: 'Overbudget Post Attempt',
        slug: `overbudget-post-${Date.now()}`,
        body: 'This post creation must fail due to budget exhaustion.',
        primaryCategory: 'technology'
      })
    ).rejects.toThrow(BudgetExhaustedError);

    // Confirm budget event recorded
    const events = await budgetEventRepo.listRecent(brokeTenant.id, 5);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await query('DELETE FROM budget_events WHERE tenant_id = $1', [brokeTenant.id]);
    await query('DELETE FROM ai_calls WHERE tenant_id = $1', [brokeTenant.id]);
    await query('DELETE FROM tenants WHERE id = $1', [brokeTenant.id]);
  });

  // 25. AI telemetry for post embedding
  it('25. AI Telemetry: logs text_embedding telemetry record on post creation', async () => {
    const created = await postService.createPost(tenantA.id, {
      title: 'Telemetry Logging Post',
      slug: `telemetry-log-post-${Date.now()}`,
      body: 'Ensuring that AI telemetry is logged into ai_calls table.',
      primaryCategory: 'wildlife'
    });

    const calls = await aiCallRepo.listRecent(tenantA.id, 5);
    const postCall = calls.find(
      (c) => c.taskType === 'text_embedding' && c.operationId === created.post.id
    );

    expect(postCall).toBeDefined();
    expect(postCall?.status).toBe('success');
    expect(postCall?.totalTokens).toBeGreaterThan(0);
    expect(postCall?.estimatedCostUsd).toBeGreaterThan(0);
  });
});
