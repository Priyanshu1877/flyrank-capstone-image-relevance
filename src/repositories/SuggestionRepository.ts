import pg from 'pg';
import { query } from '../config/database.js';
import { Suggestion, SuggestionStatus } from '../models/types.js';

export interface UpsertSuggestionDTO {
  postId: string;
  imageId: string | null;
  similarityScore: number;
  rank: number;
  guardPassed: boolean;
  rejectionReason?: string | null;
  guardDetails?: Record<string, unknown> | null;
  status?: SuggestionStatus;
}

export class SuggestionRepository {
  async upsert(
    tenantId: string,
    data: UpsertSuggestionDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Suggestion> {
    const sql = `
      INSERT INTO suggestions (
        tenant_id, post_id, image_id, similarity_score, rank,
        guard_passed, rejection_reason, guard_details, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      ON CONFLICT (tenant_id, post_id, image_id) DO UPDATE
        SET similarity_score = EXCLUDED.similarity_score,
            rank = EXCLUDED.rank,
            guard_passed = EXCLUDED.guard_passed,
            rejection_reason = EXCLUDED.rejection_reason,
            guard_details = EXCLUDED.guard_details,
            status = EXCLUDED.status
      RETURNING id, tenant_id AS "tenantId", post_id AS "postId", image_id AS "imageId",
                similarity_score AS "similarityScore", rank, guard_passed AS "guardPassed",
                rejection_reason AS "rejectionReason", guard_details AS "guardDetails",
                status, created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.postId,
      data.imageId,
      data.similarityScore,
      data.rank,
      data.guardPassed,
      data.rejectionReason ?? null,
      data.guardDetails ? JSON.stringify(data.guardDetails) : null,
      data.status ?? 'suggested'
    ];
    const res = await query<Suggestion>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to upsert suggestion');
    return this.mapRow(row);
  }

  async findById(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Suggestion | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", post_id AS "postId", image_id AS "imageId",
             similarity_score AS "similarityScore", rank, guard_passed AS "guardPassed",
             rejection_reason AS "rejectionReason", guard_details AS "guardDetails",
             status, created_at AS "createdAt"
      FROM suggestions
      WHERE tenant_id = $1 AND id = $2;
    `;
    const res = await query<Suggestion>(sql, [tenantId, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async listByPostId(
    tenantId: string,
    postId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Suggestion[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", post_id AS "postId", image_id AS "imageId",
             similarity_score AS "similarityScore", rank, guard_passed AS "guardPassed",
             rejection_reason AS "rejectionReason", guard_details AS "guardDetails",
             status, created_at AS "createdAt"
      FROM suggestions
      WHERE tenant_id = $1 AND post_id = $2
      ORDER BY rank ASC;
    `;
    const res = await query<Suggestion>(sql, [tenantId, postId], client);
    return res.rows.map((r) => this.mapRow(r));
  }

  async deleteByPostId(
    tenantId: string,
    postId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<number> {
    const sql = `DELETE FROM suggestions WHERE tenant_id = $1 AND post_id = $2;`;
    const res = await query(sql, [tenantId, postId], client);
    return res.rowCount ?? 0;
  }

  private mapRow(row: Suggestion): Suggestion {
    return {
      ...row,
      similarityScore: Number(row.similarityScore),
      rank: Number(row.rank)
    };
  }
}
