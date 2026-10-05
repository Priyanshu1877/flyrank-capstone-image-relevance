import express, { Express, Request, Response, NextFunction } from 'express';
import { createAuthMiddleware } from './middleware/auth.js';
import { createPostRouter } from './routes/postRoutes.js';
import { createReviewRouter } from './routes/reviewRoutes.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint (unauthenticated)
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'flyrank-content-matching-engine',
      timestamp: new Date().toISOString()
    });
  });

  // Authenticated tenant routes
  const authMiddleware = createAuthMiddleware();
  app.use('/posts', authMiddleware, createPostRouter());
  app.use('/reviews', authMiddleware, createReviewRouter());

  // 404 handler for undefined routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'NotFound',
      message: 'Resource or endpoint does not exist'
    });
  });

  // Global error handler - guarantees safe responses without internal stack/secret leaks
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errorObj = err as { status?: number; message?: string } | undefined;
    const status = errorObj?.status || 500;
    const message = errorObj?.message || 'Internal server error';

    res.status(status).json({
      error: status === 500 ? 'InternalServerError' : 'RequestError',
      message: status === 500 ? 'An unexpected error occurred' : message
    });
  });

  return app;
}
