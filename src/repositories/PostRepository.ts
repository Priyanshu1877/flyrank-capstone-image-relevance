import pg from 'pg';
import { query } from '../config/database.js';
import { Post, PostStatus } from '../models/types.js';

export interface CreatePostDTO {
  title: string;
  slug: string;
  body: string;
  primaryCategory?: string | null;
  status?: PostStatus;
}

export interface UpdatePostDTO {
  title?: string;
  body?: string;
  primaryCategory?: string | null;
  status?: PostStatus;
}

export interface ListPostsOptions {
  status?: PostStatus;
  primaryCategory?: string;
  limit?: number;
  offset?: number;
}

export class PostRepository {
  async create(
    tenantId: string,
    data: CreatePostDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Post> {
    const sql = `
      INSERT INTO posts (tenant_id, title, slug, body, primary_category, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, tenant_id AS "tenantId", title, slug, body,
                primary_category AS "primaryCategory", status,
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const params = [
      tenantId,
      data.title,
      data.slug,
      data.body,
      data.primaryCategory ?? null,
      data.status ?? 'draft'
    ];
    const res = await query<Post>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create post');
    return row;
  }

  async findById(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Post | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", title, slug, body,
             primary_category AS "primaryCategory", status,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM posts
      WHERE tenant_id = $1 AND id = $2;
    `;
    const res = await query<Post>(sql, [tenantId, id], client);
    return res.rows[0] || null;
  }

  async findBySlug(
    tenantId: string,
    slug: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Post | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", title, slug, body,
             primary_category AS "primaryCategory", status,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM posts
      WHERE tenant_id = $1 AND slug = $2;
    `;
    const res = await query<Post>(sql, [tenantId, slug], client);
    return res.rows[0] || null;
  }

  async list(
    tenantId: string,
    options: ListPostsOptions = {},
    client?: pg.PoolClient | pg.Pool
  ): Promise<Post[]> {
    let sql = `
      SELECT id, tenant_id AS "tenantId", title, slug, body,
             primary_category AS "primaryCategory", status,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM posts
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [tenantId];

    if (options.status) {
      params.push(options.status);
      sql += ` AND status = $${params.length}`;
    }

    if (options.primaryCategory) {
      params.push(options.primaryCategory);
      sql += ` AND primary_category = $${params.length}`;
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

    const res = await query<Post>(sql, params, client);
    return res.rows;
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdatePostDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Post | null> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.title !== undefined) {
      params.push(data.title);
      fields.push(`title = $${params.length}`);
    }
    if (data.body !== undefined) {
      params.push(data.body);
      fields.push(`body = $${params.length}`);
    }
    if (data.primaryCategory !== undefined) {
      params.push(data.primaryCategory);
      fields.push(`primary_category = $${params.length}`);
    }
    if (data.status !== undefined) {
      params.push(data.status);
      fields.push(`status = $${params.length}`);
    }

    if (fields.length === 0) {
      return this.findById(tenantId, id, client);
    }

    fields.push('updated_at = NOW()');
    params.push(tenantId, id);

    const sql = `
      UPDATE posts
      SET ${fields.join(', ')}
      WHERE tenant_id = $${params.length - 1} AND id = $${params.length}
      RETURNING id, tenant_id AS "tenantId", title, slug, body,
                primary_category AS "primaryCategory", status,
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;

    const res = await query<Post>(sql, params, client);
    return res.rows[0] || null;
  }

  async delete(tenantId: string, id: string, client?: pg.PoolClient | pg.Pool): Promise<boolean> {
    const sql = `DELETE FROM posts WHERE tenant_id = $1 AND id = $2;`;
    const res = await query(sql, [tenantId, id], client);
    return (res.rowCount ?? 0) > 0;
  }
}
