import pg from 'pg';
import { query } from '../config/database.js';
import { Image, ImageStatus } from '../models/types.js';

export interface CreateImageDTO {
  url: string;
  originalFilename?: string | null;
}

export interface ListImagesOptions {
  status?: ImageStatus;
  limit?: number;
  offset?: number;
}

export interface CandidateImage {
  imageId: string;
  url: string;
  status: ImageStatus;
  flagged: boolean;
  dimensions: number;
  embedding: number[];
  modelName: string;
  category: string;
  subject: string;
  confidence: number;
  caption: string;
  attributes: string[];
}

export class ImageRepository {
  async create(
    tenantId: string,
    data: CreateImageDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Image> {
    const sql = `
      INSERT INTO images (tenant_id, url, original_filename, status, flagged)
      VALUES ($1, $2, $3, 'pending', FALSE)
      ON CONFLICT (tenant_id, url) DO UPDATE
        SET original_filename = EXCLUDED.original_filename,
            updated_at = NOW()
      RETURNING id, tenant_id AS "tenantId", url, original_filename AS "originalFilename",
                status, flagged, created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const params = [tenantId, data.url, data.originalFilename ?? null];
    const res = await query<Image>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create or upsert image');
    return row;
  }

  async findById(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Image | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", url, original_filename AS "originalFilename",
             status, flagged, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM images
      WHERE tenant_id = $1 AND id = $2;
    `;
    const res = await query<Image>(sql, [tenantId, id], client);
    return res.rows[0] || null;
  }

  async findByUrl(
    tenantId: string,
    url: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Image | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", url, original_filename AS "originalFilename",
             status, flagged, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM images
      WHERE tenant_id = $1 AND url = $2;
    `;
    const res = await query<Image>(sql, [tenantId, url], client);
    return res.rows[0] || null;
  }

  async list(
    tenantId: string,
    options: ListImagesOptions = {},
    client?: pg.PoolClient | pg.Pool
  ): Promise<Image[]> {
    let sql = `
      SELECT id, tenant_id AS "tenantId", url, original_filename AS "originalFilename",
             status, flagged, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM images
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];

    if (options.status) {
      params.push(options.status);
      sql += ` AND status = $${params.length}`;
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

    const res = await query<Image>(sql, params, client);
    return res.rows;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ImageStatus,
    flagged?: boolean,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Image | null> {
    let sql = `
      UPDATE images
      SET status = $1, updated_at = NOW()
    `;
    const params: unknown[] = [status];

    if (flagged !== undefined) {
      params.push(flagged);
      sql += `, flagged = $${params.length}`;
    }

    params.push(tenantId, id);
    sql += ` WHERE tenant_id = $${params.length - 1} AND id = $${params.length}
      RETURNING id, tenant_id AS "tenantId", url, original_filename AS "originalFilename",
                status, flagged, created_at AS "createdAt", updated_at AS "updatedAt";
    `;

    const res = await query<Image>(sql, params, client);
    return res.rows[0] || null;
  }

  async delete(tenantId: string, id: string, client?: pg.PoolClient | pg.Pool): Promise<boolean> {
    const sql = `DELETE FROM images WHERE tenant_id = $1 AND id = $2;`;
    const res = await query(sql, [tenantId, id], client);
    return (res.rowCount ?? 0) > 0;
  }

  async listCandidatesForMatching(
    tenantId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<CandidateImage[]> {
    const sql = `
      SELECT 
        i.id AS "imageId",
        i.url,
        i.status,
        i.flagged,
        iv.dimensions,
        iv.embedding,
        iv.model_name AS "modelName",
        im.category,
        im.subject,
        im.confidence,
        im.caption,
        im.attributes
      FROM images i
      JOIN image_vectors iv ON i.id = iv.image_id AND i.tenant_id = iv.tenant_id
      JOIN image_metadata im ON i.id = im.image_id AND i.tenant_id = im.tenant_id
      WHERE i.tenant_id = $1
      ORDER BY i.created_at ASC;
    `;
    const res = await query<{
      imageId: string;
      url: string;
      status: ImageStatus;
      flagged: boolean;
      dimensions: number;
      embedding: string | number[];
      modelName: string;
      category: string;
      subject: string;
      confidence: number;
      caption: string;
      attributes: string | string[];
    }>(sql, [tenantId], client);

    return res.rows.map((r) => ({
      imageId: r.imageId,
      url: r.url,
      status: r.status,
      flagged: Boolean(r.flagged),
      dimensions: Number(r.dimensions),
      embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
      modelName: r.modelName,
      category: r.category,
      subject: r.subject,
      confidence: Number(r.confidence),
      caption: r.caption,
      attributes: typeof r.attributes === 'string' ? JSON.parse(r.attributes) : (r.attributes ?? [])
    }));
  }
}
