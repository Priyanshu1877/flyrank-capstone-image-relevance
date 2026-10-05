import { describe, it, expect, afterAll } from 'vitest';
import { query, withTransaction, closePool } from '../src/config/database.js';

describe('Database Connection & Transaction Infrastructure', () => {
  afterAll(async () => {
    await closePool();
  });

  it('1. should successfully connect to PostgreSQL and execute a query', async () => {
    const res = await query<{ connected: number }>('SELECT 1 AS connected;');
    expect(res.rows[0]?.connected).toBe(1);
  });

  it('2. should distinguish not-found query from error', async () => {
    const res = await query('SELECT * FROM images WHERE id = $1;', [
      '00000000-0000-0000-0000-000000000000'
    ]);
    expect(res.rows).toEqual([]);
    expect(res.rowCount).toBe(0);
  });

  it('3. should rollback changes upon error within a transaction', async () => {
    const testUrl = `https://rollback-test-${Date.now()}.com/img.jpg`;

    await expect(
      withTransaction(async (client) => {
        // Insert a temporary image
        await client.query(
          `INSERT INTO images (tenant_id, url, status) VALUES ($1, $2, 'pending');`,
          ['e1f1c7d2-3498-4c1d-84fb-39074742a001', testUrl]
        );

        // Force an error to trigger rollback
        throw new Error('Forced transaction failure for rollback verification');
      })
    ).rejects.toThrow('Forced transaction failure for rollback verification');

    // Verify row was rolled back and does not exist in database
    const check = await query('SELECT * FROM images WHERE url = $1;', [testUrl]);
    expect(check.rows.length).toBe(0);
  });
});
