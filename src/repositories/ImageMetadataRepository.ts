import pg from 'pg';
import { query } from '../config/database.js';
import { ImageMetadata } from '../models/types.js';

export interface UpsertImageMetadataDTO {
  imageId: string;
  subject: string;
  category: string;
  caption: string;
  attributes: string[];
  confidence: number;
  rawResponse?: Record<string, unknown> | null;
}

export class ImageMetadataRepository {
  async upsert(
    tenantId: string,
    data: UpsertImageMetadataDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<ImageMetadata> {
    const sql = `
      INSERT INTO image_metadata (tenant_id, image_id, subject, category, caption, attributes, confidence, raw_response)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
      ON CONFLICT (tenant_id, image_id) DO UPDATE
        SET subject = EXCLUDED.subject,
            category = EXCLUDED.category,
            caption = EXCLUDED.caption,
            attributes = EXCLUDED.attributes,
            confidence = EXCLUDED.confidence,
            raw_response = EXCLUDED.raw_response
      RETURNING id, tenant_id AS "tenantId", image_id AS "imageId", subject, category, caption,
                attributes, confidence, raw_response AS "rawResponse", created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.imageId,
      data.subject,
      data.category,
      data.caption,
      JSON.stringify(data.attributes),
      data.confidence,
      data.rawResponse ? JSON.stringify(data.rawResponse) : null
    ];
    const res = await query<ImageMetadata>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to upsert image metadata');
    return this.mapRow(row);
  }

  async findByImageId(
    tenantId: string,
    imageId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<ImageMetadata | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", image_id AS "imageId", subject, category, caption,
             attributes, confidence, raw_response AS "rawResponse", created_at AS "createdAt"
      FROM image_metadata
      WHERE tenant_id = $1 AND image_id = $2;
    `;
    const res = await query<ImageMetadata>(sql, [tenantId, imageId], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: ImageMetadata): ImageMetadata {
    return {
      ...row,
      confidence: Number(row.confidence),
      attributes: typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes
    };
  }
}
