import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ReviewService } from '../services/ReviewService.js';
import { CreateReviewSchema } from '../schemas/index.js';
import { ReviewDecision } from '../models/types.js';

export function createReviewRouter(reviewService = new ReviewService()): Router {
  const router = Router();

  // POST /reviews - Create editorial review on a suggestion
  router.post(
    '/',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const parseResult = CreateReviewSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: 'ValidationError',
            message: 'Invalid review payload',
            details: parseResult.error.issues
          });
          return;
        }

        const review = await reviewService.createReview(tenantId, parseResult.data);
        res.status(201).json({ data: review });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('access denied') || message.includes('not found')) {
          res.status(404).json({
            error: 'NotFound',
            message
          });
          return;
        }
        next(err);
      }
    }
  );

  // GET /reviews - List reviews for tenant
  router.get(
    '/',
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const tenantId = req.tenant!.id;
        const { decision, limit, offset } = req.query;

        const validDecisions: ReviewDecision[] = ['approved', 'rejected', 'modified'];
        const decisionFilter =
          typeof decision === 'string' && validDecisions.includes(decision as ReviewDecision)
            ? (decision as ReviewDecision)
            : undefined;

        const reviews = await reviewService.listReviews(tenantId, {
          decision: decisionFilter,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined
        });

        res.status(200).json({
          data: reviews,
          meta: { count: reviews.length }
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
