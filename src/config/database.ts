import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// Global pool instance
let poolInstance: pg.Pool | null = null;

export function getPool(connectionStringOverride?: string): pg.Pool {
  if (poolInstance && !connectionStringOverride) {
    return poolInstance;
  }

  const connString =
    connectionStringOverride ||
    (env.NODE_ENV === 'test' && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL);

  const pool = new Pool({
    connectionString: connString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    // Log sanitized error message without exposing connection strings
    console.error('[PostgreSQL] Unexpected client error on idle connection:', err.message);
  });

  if (!connectionStringOverride) {
    poolInstance = pool;
  }

  return pool;
}

export const pool = getPool();

/**
 * Execute a parameterized SQL query safely against the connection pool.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  client?: pg.PoolClient | pg.Pool
): Promise<pg.QueryResult<T>> {
  const runner = client || pool;
  return runner.query<T>(text, params);
}

/**
 * Execute an operation inside an atomic database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK upon error.
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
  poolToUse?: pg.Pool
): Promise<T> {
  const p = poolToUse || pool;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[PostgreSQL] Error during transaction rollback:', rollbackErr);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the connection pool.
 */
export async function closePool(targetPool?: pg.Pool): Promise<void> {
  const p = targetPool || poolInstance;
  if (p) {
    await p.end();
    if (p === poolInstance) {
      poolInstance = null;
    }
  }
}
