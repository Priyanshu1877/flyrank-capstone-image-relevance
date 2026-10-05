import { PostRepository, CreatePostDTO, ListPostsOptions } from '../repositories/PostRepository.js';
import { PostVectorRepository } from '../repositories/PostVectorRepository.js';
import { BudgetGuardService } from './BudgetGuardService.js';
import { IEmbeddingProvider, resolveEmbeddingProvider } from './ai/index.js';
import { CreatePostSchema } from '../schemas/index.js';
import { Post, PostVector } from '../models/types.js';

export interface CreatePostResult {
  post: Post;
  vector: PostVector;
}

export class PostService {
  constructor(
    private readonly postRepo = new PostRepository(),
    private readonly postVectorRepo = new PostVectorRepository(),
    private readonly budgetGuard = new BudgetGuardService()
  ) {}

  /**
   * Synthesizes a standardized, dense textual representation of a post for embedding indexing.
   */
  static buildPostEmbeddingText(post: {
    title: string;
    body: string;
    primaryCategory?: string | null;
  }): string {
    const normCategory = (post.primaryCategory || 'general').trim().toLowerCase();
    const normTitle = post.title.trim();
    const normBody = post.body.trim();

    return `Category: ${normCategory}. Title: ${normTitle}. Content: ${normBody}`;
  }

  /**
   * Creates a post record and synchronously extracts and indexes its semantic vector embedding.
   */
  async createPost(
    tenantId: string,
    data: CreatePostDTO,
    options?: { embeddingProvider?: IEmbeddingProvider }
  ): Promise<CreatePostResult> {
    // Step 1: Strict input validation
    const validation = CreatePostSchema.safeParse(data);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid post data: ${issues}`);
    }

    const embeddingProvider = options?.embeddingProvider ?? resolveEmbeddingProvider();

    // Step 2: Persist Post
    const post = await this.postRepo.create(tenantId, validation.data);

    // Step 3: Check AI Budget before embedding call
    await this.budgetGuard.assertBudgetAvailable(tenantId, 'GENERATE_POST_EMBEDDING');

    // Step 4: Build normalized embedding text
    const textToEmbed = PostService.buildPostEmbeddingText(post);

    // Step 5: Generate Vector Embedding
    const embeddingResult = await embeddingProvider.generateEmbedding(textToEmbed);

    // Validate vector dimensions & values
    if (
      !Array.isArray(embeddingResult.embedding) ||
      embeddingResult.embedding.length !== embeddingProvider.expectedDimensions
    ) {
      throw new Error(
        `Post embedding dimension mismatch: expected ${embeddingProvider.expectedDimensions}, got ${embeddingResult.embedding?.length}`
      );
    }

    for (let i = 0; i < embeddingResult.embedding.length; i++) {
      const val = embeddingResult.embedding[i];
      if (val === undefined || !Number.isFinite(val)) {
        throw new Error(`Post embedding vector contains non-finite value at index ${i}`);
      }
    }

    // Step 6: Log Telemetry in ai_calls
    await this.budgetGuard.recordTelemetry(tenantId, {
      callIdentity: `post:${post.id}:embedding:${Date.now()}`,
      operationId: post.id,
      attempt: 1,
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

    // Step 7: Persist Post Vector
    const vector = await this.postVectorRepo.upsert(tenantId, {
      postId: post.id,
      modelName: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
      embedding: embeddingResult.embedding
    });

    return { post, vector };
  }

  async getPostById(tenantId: string, id: string): Promise<Post | null> {
    return this.postRepo.findById(tenantId, id);
  }

  async getPostWithVector(
    tenantId: string,
    id: string
  ): Promise<{ post: Post; vector: PostVector | null } | null> {
    const post = await this.postRepo.findById(tenantId, id);
    if (!post) return null;

    const vector = await this.postVectorRepo.findByPostId(tenantId, id);
    return { post, vector };
  }

  async listPosts(tenantId: string, options: ListPostsOptions = {}): Promise<Post[]> {
    return this.postRepo.list(tenantId, options);
  }
}
