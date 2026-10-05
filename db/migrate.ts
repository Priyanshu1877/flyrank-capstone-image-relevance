import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool } from '../src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(customPool?: pg.Pool): Promise<string[]> {
  const pool = customPool || getPool();
  const client = await pool.connect();
  const appliedMigrations: string[] = [];

  try {
    // Ensure migrations ledger table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const existing = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1;',
        [file]
      );

      if (existing.rowCount === 0) {
        console.log(`[Migrations] Applying: ${file}...`);
        const filePath = path.join(migrationsDir, file);
        const sql = await fs.readFile(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1);', [file]);
          await client.query('COMMIT');
          appliedMigrations.push(file);
          console.log(`[Migrations] Successfully applied: ${file}`);
        } catch (migrationErr) {
          await client.query('ROLLBACK');
          console.error(`[Migrations] Migration failed on ${file}:`, migrationErr);
          throw migrationErr;
        }
      } else {
        // Already applied
      }
    }

    return appliedMigrations;
  } finally {
    client.release();
  }
}

// If executed directly from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((applied) => {
      console.log(`[Migrations] Done. ${applied.length} new migration(s) applied.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migrations] Fatal migration error:', err);
      process.exit(1);
    });
}
