import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { PostService } from '../services/PostService.js';
import { MatchingEngineService } from '../services/matching/MatchingEngineService.js';
import { CreatePostSchema } from '../schemas/index.js';
import { PostStatus } from '../models/types.js';

export function createPostRouter(
  postService = new PostService(),
  matchingEngine = new MatchingEngineService()
): Router {
  const router = Router();

  // POST /posts - Ingest post and generate embedding
  router.post(
    '/',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const parseResult = CreatePostSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: 'ValidationError',
            message: 'Invalid post payload',
            details: parseResult.error.issues
          });
          return;
        }

        const result = await postService.createPost(tenantId, parseResult.data);
        res.status(201).json({
          data: result.post,
          meta: {
            vectorId: result.vector.id,
            modelName: result.vector.modelName,
            dimensions: result.vector.dimensions
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Budget exceeded')) {
          res.status(402).json({
            error: 'BudgetExceeded',
            message
          });
          return;
        }
        next(err);
      }
    }
  );

  // GET /posts - List tenant's posts
  router.get(
    '/',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const { status, limit, offset } = req.query;

        const validStatuses: PostStatus[] = ['draft', 'published', 'archived'];
        const statusFilter =
          typeof status === 'string' && validStatuses.includes(status as PostStatus)
            ? (status as PostStatus)
            : undefined;

        const posts = await postService.listPosts(tenantId, {
          status: statusFilter,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined
        });

        res.status(200).json({
          data: posts,
          meta: { count: posts.length }
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /posts/:id - Retrieve specific post
  router.get(
    '/:id',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const postId = req.params.id;
        if (!postId || typeof postId !== 'string') {
          res.status(400).json({ error: 'BadRequest', message: 'Missing post ID parameter' });
          return;
        }
        const post = await postService.getPostById(tenantId, postId);

        if (!post) {
          res.status(404).json({
            error: 'NotFound',
            message: `Post ${postId} not found`
          });
          return;
        }

        res.status(200).json({ data: post });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /posts/:id/images - Execute semantic matching engine & mismatch guard
  router.get(
    '/:id/images',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const postId = req.params.id;
        if (!postId || typeof postId !== 'string') {
          res.status(400).json({ error: 'BadRequest', message: 'Missing post ID parameter' });
          return;
        }
        const { threshold, confidenceFloor } = req.query;

        const result = await matchingEngine.matchPost(tenantId, postId, {
          similarityThreshold: threshold ? Number(threshold) : undefined,
          confidenceFloor: confidenceFloor ? Number(confidenceFloor) : undefined
        });

        res.status(200).json({ data: result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Post not found')) {
          res.status(404).json({
            error: 'NotFound',
            message
          });
          return;
        }
        if (message.includes('embedding not found')) {
          res.status(422).json({
            error: 'UnprocessableEntity',
            message
          });
          return;
        }
        next(err);
      }
    }
  );

  return router;
}
