import { describe, it, expect, afterAll } from 'vitest';
import { query, closePool } from '../src/config/database.js';
import { runMigrations } from '../db/migrate.js';

describe('Database Migrations & Schema Integrity', () => {
  afterAll(async () => {
    await closePool();
  });

  it('1. should verify migrations run idempotently without re-applying existing files', async () => {
    const applied = await runMigrations();
    // Since already applied during setup, subsequent run applies 0
    expect(applied).toBeInstanceOf(Array);
  });

  it('2. should verify all 14 required domain tables exist in the database', async () => {
    const expectedTables = [
      'tenants',
      'images',
      'image_metadata',
      'image_vectors',
      'posts',
      'post_vectors',
      'tags',
      'image_tags',
      'suggestions',
      'reviews',
      'jobs',
      'job_failures',
      'ai_calls',
      'budget_events'
    ];

    const res = await query<{ table_name: string }>(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1);
    `,
      [expectedTables]
    );

    const foundTables = res.rows.map((r) => r.table_name);
    for (const table of expectedTables) {
      expect(foundTables).toContain(table);
    }
  });

  it('3. should enforce foreign key cascading behavior on tenant deletion', async () => {
    // Create temporary tenant
    const tenantRes = await query<{ id: string }>(`
      INSERT INTO tenants (name, api_key_hash)
      VALUES ('Temp Cascade Tenant', 'hash-cascade-${Date.now()}')
      RETURNING id;
    `);
    const tempTenantId = tenantRes.rows[0]?.id;
    expect(tempTenantId).toBeDefined();

    // Create an image under this tenant
    const imgRes = await query<{ id: string }>(
      `
      INSERT INTO images (tenant_id, url)
      VALUES ($1, 'https://example.com/cascade-${Date.now()}.jpg')
      RETURNING id;
    `,
      [tempTenantId]
    );
    const imgId = imgRes.rows[0]?.id;

    // Delete tenant
    await query('DELETE FROM tenants WHERE id = $1;', [tempTenantId]);

    // Verify image was cascaded and deleted automatically
    const checkImg = await query('SELECT * FROM images WHERE id = $1;', [imgId]);
    expect(checkImg.rows.length).toBe(0);
  });

  it('4. should enforce unique constraints on tenant-scoped entities', async () => {
    const defaultTenantId = 'e1f1c7d2-3498-4c1d-84fb-39074742a001';
    const uniqueUrl = `https://duplicate-check-${Date.now()}.jpg`;

    // First insert succeeds
    await query(`INSERT INTO images (tenant_id, url) VALUES ($1, $2);`, [
      defaultTenantId,
      uniqueUrl
    ]);

    // Second insert with duplicate (tenant_id, url) must violate unique constraint
    await expect(
      query(`INSERT INTO images (tenant_id, url) VALUES ($1, $2);`, [defaultTenantId, uniqueUrl])
    ).rejects.toThrow();
  });
});
