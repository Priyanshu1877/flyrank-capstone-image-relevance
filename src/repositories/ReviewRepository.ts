import pg from 'pg';
import { query } from '../config/database.js';
import { Review, ReviewDecision } from '../models/types.js';

export interface CreateReviewDTO {
  suggestionId: string;
  decision: ReviewDecision;
  notes?: string | null;
  reviewerId?: string;
}

export class ReviewRepository {
  async create(
    tenantId: string,
    data: CreateReviewDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Review> {
    const sql = `
      INSERT INTO reviews (tenant_id, suggestion_id, decision, notes, reviewer_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tenant_id AS "tenantId", suggestion_id AS "suggestionId",
                decision, notes, reviewer_id AS "reviewerId", created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.suggestionId,
      data.decision,
      data.notes ?? null,
      data.reviewerId ?? 'editorial_team'
    ];
    const res = await query<Review>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create review');
    return row;
  }

  async listBySuggestion(
    tenantId: string,
    suggestionId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Review[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", suggestion_id AS "suggestionId",
             decision, notes, reviewer_id AS "reviewerId", created_at AS "createdAt"
      FROM reviews
      WHERE tenant_id = $1 AND suggestion_id = $2
      ORDER BY created_at DESC;
    `;
    const res = await query<Review>(sql, [tenantId, suggestionId], client);
    return res.rows;
  }

  async list(
    tenantId: string,
    options: { decision?: ReviewDecision; limit?: number; offset?: number } = {},
    client?: pg.PoolClient | pg.Pool
  ): Promise<Review[]> {
    let sql = `
      SELECT id, tenant_id AS "tenantId", suggestion_id AS "suggestionId",
             decision, notes, reviewer_id AS "reviewerId", created_at AS "createdAt"
      FROM reviews
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];

    if (options.decision) {
      params.push(options.decision);
      sql += ` AND decision = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC`;

    if (options.limit) {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (options.offset) {
      params.push(options.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const res = await query<Review>(sql, params, client);
    return res.rows;
  }
}
