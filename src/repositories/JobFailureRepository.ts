import pg from 'pg';
import { query } from '../config/database.js';
import { JobFailure } from '../models/types.js';

export interface RecordJobFailureDTO {
  jobId: string;
  attempt: number;
  errorMessage: string;
  stackTrace?: string | null;
}

export class JobFailureRepository {
  async record(
    tenantId: string,
    data: RecordJobFailureDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<JobFailure> {
    const sql = `
      INSERT INTO job_failures (tenant_id, job_id, attempt, error_message, stack_trace)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tenant_id AS "tenantId", job_id AS "jobId", attempt,
                error_message AS "errorMessage", stack_trace AS "stackTrace", failed_at AS "failedAt";
    `;
    const params = [tenantId, data.jobId, data.attempt, data.errorMessage, data.stackTrace ?? null];
    const res = await query<JobFailure>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to record job failure');
    return {
      ...row,
      attempt: Number(row.attempt)
    };
  }

  async listByJob(
    tenantId: string,
    jobId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<JobFailure[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", job_id AS "jobId", attempt,
             error_message AS "errorMessage", stack_trace AS "stackTrace", failed_at AS "failedAt"
      FROM job_failures
      WHERE tenant_id = $1 AND job_id = $2
      ORDER BY attempt ASC;
    `;
    const res = await query<JobFailure>(sql, [tenantId, jobId], client);
    return res.rows.map((r) => ({
      ...r,
      attempt: Number(r.attempt)
    }));
  }
}
