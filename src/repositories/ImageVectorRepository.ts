import pg from 'pg';
import { query } from '../config/database.js';
import { ImageVector } from '../models/types.js';

export interface UpsertImageVectorDTO {
  imageId: string;
  modelName: string;
  dimensions: number;
  embedding: number[];
}

export class ImageVectorRepository {
  async upsert(
    tenantId: string,
    data: UpsertImageVectorDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<ImageVector> {
    const sql = `
      INSERT INTO image_vectors (tenant_id, image_id, model_name, dimensions, embedding)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (tenant_id, image_id) DO UPDATE
        SET model_name = EXCLUDED.model_name,
            dimensions = EXCLUDED.dimensions,
            embedding = EXCLUDED.embedding
      RETURNING id, tenant_id AS "tenantId", image_id AS "imageId", model_name AS "modelName",
                dimensions, embedding, created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.imageId,
      data.modelName,
      data.dimensions,
      JSON.stringify(data.embedding)
    ];
    const res = await query<ImageVector>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to upsert image vector');
    return this.mapRow(row);
  }

  async findByImageId(
    tenantId: string,
    imageId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<ImageVector | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", image_id AS "imageId", model_name AS "modelName",
             dimensions, embedding, created_at AS "createdAt"
      FROM image_vectors
      WHERE tenant_id = $1 AND image_id = $2;
    `;
    const res = await query<ImageVector>(sql, [tenantId, imageId], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async listAllForTenant(
    tenantId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<ImageVector[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", image_id AS "imageId", model_name AS "modelName",
             dimensions, embedding, created_at AS "createdAt"
      FROM image_vectors
      WHERE tenant_id = $1;
    `;
    const res = await query<ImageVector>(sql, [tenantId], client);
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: ImageVector): ImageVector {
    return {
      ...row,
      dimensions: Number(row.dimensions),
      embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding
    };
  }
}
