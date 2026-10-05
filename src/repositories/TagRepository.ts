import pg from 'pg';
import { query } from '../config/database.js';
import { Tag } from '../models/types.js';

export class TagRepository {
  async findOrCreate(
    tenantId: string,
    name: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Tag> {
    const cleanName = name.trim().toLowerCase();
    const selectSql = `
      SELECT id, tenant_id AS "tenantId", name, created_at AS "createdAt"
      FROM tags
      WHERE tenant_id = $1 AND name = $2;
    `;
    const existing = await query<Tag>(selectSql, [tenantId, cleanName], client);
    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const insertSql = `
      INSERT INTO tags (tenant_id, name)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, tenant_id AS "tenantId", name, created_at AS "createdAt";
    `;
    const res = await query<Tag>(insertSql, [tenantId, cleanName], client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to find or create tag');
    return row;
  }

  async associateWithImage(
    tenantId: string,
    imageId: string,
    tagId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<void> {
    const sql = `
      INSERT INTO image_tags (tenant_id, image_id, tag_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, image_id, tag_id) DO NOTHING;
    `;
    await query(sql, [tenantId, imageId, tagId], client);
  }

  async getTagsForImage(
    tenantId: string,
    imageId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Tag[]> {
    const sql = `
      SELECT t.id, t.tenant_id AS "tenantId", t.name, t.created_at AS "createdAt"
      FROM tags t
      INNER JOIN image_tags it ON it.tag_id = t.id AND it.tenant_id = t.tenant_id
      WHERE it.tenant_id = $1 AND it.image_id = $2
      ORDER BY t.name ASC;
    `;
    const res = await query<Tag>(sql, [tenantId, imageId], client);
    return res.rows;
  }
}
