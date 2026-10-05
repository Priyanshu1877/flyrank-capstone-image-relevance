import pg from 'pg';
import { query } from '../config/database.js';
import { Job, JobType, JobStatus } from '../models/types.js';

export interface EnqueueJobDTO {
  idempotencyKey: string;
  type: JobType;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  scheduledAt?: Date;
}

export class JobRepository {
  async enqueue(
    tenantId: string,
    data: EnqueueJobDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job> {
    const sql = `
      INSERT INTO jobs (tenant_id, idempotency_key, type, payload, max_attempts, scheduled_at, status)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'queued')
      ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
        SET updated_at = NOW()
      RETURNING id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
                type, payload, status, attempts, max_attempts AS "maxAttempts",
                scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const params = [
      tenantId,
      data.idempotencyKey,
      data.type,
      JSON.stringify(data.payload),
      data.maxAttempts ?? 3,
      data.scheduledAt ?? new Date()
    ];
    const res = await query<Job>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to enqueue job');
    return this.mapRow(row);
  }

  async findById(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
             type, payload, status, attempts, max_attempts AS "maxAttempts",
             scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
             completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM jobs
      WHERE tenant_id = $1 AND id = $2;
    `;
    const res = await query<Job>(sql, [tenantId, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async findByIdempotencyKey(
    tenantId: string,
    key: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
             type, payload, status, attempts, max_attempts AS "maxAttempts",
             scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
             completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM jobs
      WHERE tenant_id = $1 AND idempotency_key = $2;
    `;
    const res = await query<Job>(sql, [tenantId, key], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async fetchNextAvailable(tenantId: string, client: pg.PoolClient): Promise<Job | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
             type, payload, status, attempts, max_attempts AS "maxAttempts",
             scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
             completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM jobs
      WHERE tenant_id = $1
        AND status = 'queued'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;
    `;
    const res = await client.query<Job>(sql, [tenantId]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async fetchNextAvailableAnyTenant(client: pg.PoolClient): Promise<Job | null> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
             type, payload, status, attempts, max_attempts AS "maxAttempts",
             scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
             completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM jobs
      WHERE status = 'queued'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;
    `;
    const res = await client.query<Job>(sql);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async reclaimStaleJobs(
    staleThresholdMinutes = 5,
    client?: pg.PoolClient | pg.Pool
  ): Promise<number> {
    const sql = `
      UPDATE jobs
      SET status = 'queued',
          locked_at = NULL,
          updated_at = NOW()
      WHERE status = 'processing'
        AND locked_at < NOW() - ($1 || ' minutes')::interval
      RETURNING id;
    `;
    const res = await query<{ id: string }>(sql, [staleThresholdMinutes], client);
    return res.rowCount ?? 0;
  }

  async markProcessing(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const sql = `
      UPDATE jobs
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = NOW(),
          updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
                type, payload, status, attempts, max_attempts AS "maxAttempts",
                scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await query<Job>(sql, [tenantId, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async markCompleted(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const sql = `
      UPDATE jobs
      SET status = 'completed',
          completed_at = NOW(),
          locked_at = NULL,
          updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
                type, payload, status, attempts, max_attempts AS "maxAttempts",
                scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await query<Job>(sql, [tenantId, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async markFailed(
    tenantId: string,
    id: string,
    nextScheduledAt?: Date | null,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const isRetry = nextScheduledAt !== null && nextScheduledAt !== undefined;
    const nextStatus: JobStatus = isRetry ? 'queued' : 'failed';

    const sql = `
      UPDATE jobs
      SET status = $1,
          scheduled_at = COALESCE($2, scheduled_at),
          locked_at = NULL,
          updated_at = NOW()
      WHERE tenant_id = $3 AND id = $4
      RETURNING id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
                type, payload, status, attempts, max_attempts AS "maxAttempts",
                scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const params = [nextStatus, nextScheduledAt ?? null, tenantId, id];
    const res = await query<Job>(sql, params, client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async markBudgetRejected(
    tenantId: string,
    id: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Job | null> {
    const sql = `
      UPDATE jobs
      SET status = 'budget_rejected',
          locked_at = NULL,
          updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id AS "tenantId", idempotency_key AS "idempotencyKey",
                type, payload, status, attempts, max_attempts AS "maxAttempts",
                scheduled_at AS "scheduledAt", locked_at AS "lockedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await query<Job>(sql, [tenantId, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: Job): Job {
    return {
      ...row,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.maxAttempts),
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    };
  }
}
