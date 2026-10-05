import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { TenantRepository } from '../repositories/TenantRepository.js';
import { Tenant } from '../models/types.js';

export interface AuthenticatedRequest extends Request {
  tenant?: Tenant;
}

export function createAuthMiddleware(tenantRepo = new TenantRepository()) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers['authorization'];
      const apiKeyHeader = req.headers['x-api-key'];

      let rawKey: string | null = null;

      if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
        rawKey = apiKeyHeader.trim();
      } else if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        rawKey = authHeader.substring(7).trim();
      }

      if (!rawKey) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing API key. Provide via X-API-Key or Authorization: Bearer <key>'
        });
        return;
      }

      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const tenant = await tenantRepo.findByApiKeyHash(hash);

      if (!tenant) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid API key'
        });
        return;
      }

      req.tenant = tenant;
      next();
    } catch {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Authentication failure'
      });
    }
  };
}
