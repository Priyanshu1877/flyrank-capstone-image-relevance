import pg from 'pg';
import { query } from '../config/database.js';
import { PostVector } from '../models/types.js';

export interface UpsertPostVectorDTO {
  postId: string;
  modelName: string;
  dimensions: number;
  embedding: number[];
}

export class PostVectorRepository {
  async upsert(
    tenantId: string,
    data: UpsertPostVectorDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<PostVector> {
    const sql = `
      INSERT INTO post_vectors (tenant_id, post_id, model_name, dimensions, embedding)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (tenant_id, post_id) DO UPDATE
        SET model_name = EXCLUDED.model_name,
            dimensions = EXCLUDED.dimensions,
            embedding = EXCLUDED.embedding
      RETURNING id, tenant_id AS "tenantId", post_id AS "postId", model_name AS "modelName",
                dimensions, embedding, created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.postId,
      data.modelName,
      data.dimensions,
      JSON.stringify(data.embedding)
    ];
    const res = await query<PostVector>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to upsert post vector');
    return this.mapRow(row);
  }

  async findByPostId(
    tenantId: string,
    postId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<PostVector | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", post_id AS "postId", model_name AS "modelName",
             dimensions, embedding, created_at AS "createdAt"
      FROM post_vectors
      WHERE tenant_id = $1 AND post_id = $2;
    `;
    const res = await query<PostVector>(sql, [tenantId, postId], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: PostVector): PostVector {
    return {
      ...row,
      dimensions: Number(row.dimensions),
      embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding
    };
  }
}
