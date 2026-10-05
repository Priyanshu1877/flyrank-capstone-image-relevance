import pg from 'pg';
import { query } from '../config/database.js';
import { AICall, AICallStatus, AICallTaskType } from '../models/types.js';

export interface RecordAICallDTO {
  callIdentity: string;
  operationId: string;
  attempt?: number;
  provider: string;
  model: string;
  taskType: AICallTaskType;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  status: AICallStatus;
  errorCode?: string | null;
}

export class AICallRepository {
  async record(
    tenantId: string,
    data: RecordAICallDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<AICall> {
    const sql = `
      INSERT INTO ai_calls (
        tenant_id, call_identity, operation_id, attempt, provider, model,
        task_type, input_tokens, output_tokens, total_tokens,
        estimated_cost_usd, latency_ms, status, error_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (call_identity) DO UPDATE
        SET status = EXCLUDED.status,
            error_code = EXCLUDED.error_code
      RETURNING id, tenant_id AS "tenantId", call_identity AS "callIdentity",
                operation_id AS "operationId", attempt, provider, model,
                task_type AS "taskType", input_tokens AS "inputTokens",
                output_tokens AS "outputTokens", total_tokens AS "totalTokens",
                estimated_cost_usd AS "estimatedCostUsd", latency_ms AS "latencyMs",
                status, error_code AS "errorCode", created_at AS "createdAt";
    `;
    const params = [
      tenantId,
      data.callIdentity,
      data.operationId,
      data.attempt ?? 1,
      data.provider,
      data.model,
      data.taskType,
      data.inputTokens ?? 0,
      data.outputTokens ?? 0,
      data.totalTokens ?? 0,
      data.estimatedCostUsd ?? 0.0,
      data.latencyMs,
      data.status,
      data.errorCode ?? null
    ];
    const res = await query<AICall>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to record AI telemetry call');
    return this.mapRow(row);
  }

  async getTenantCumulativeSpend(
    tenantId: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(estimated_cost_usd), 0.0) AS total_spend
      FROM ai_calls
      WHERE tenant_id = $1 AND status = 'success';
    `;
    const res = await query<{ total_spend: string | number }>(sql, [tenantId], client);
    return Number(res.rows[0]?.total_spend ?? 0);
  }

  async listRecent(
    tenantId: string,
    limit = 20,
    client?: pg.PoolClient | pg.Pool
  ): Promise<AICall[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", call_identity AS "callIdentity",
             operation_id AS "operationId", attempt, provider, model,
             task_type AS "taskType", input_tokens AS "inputTokens",
             output_tokens AS "outputTokens", total_tokens AS "totalTokens",
             estimated_cost_usd AS "estimatedCostUsd", latency_ms AS "latencyMs",
             status, error_code AS "errorCode", created_at AS "createdAt"
      FROM ai_calls
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const res = await query<AICall>(sql, [tenantId, limit], client);
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: AICall): AICall {
    return {
      ...row,
      attempt: Number(row.attempt),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      totalTokens: Number(row.totalTokens),
      estimatedCostUsd: Number(row.estimatedCostUsd),
      latencyMs: Number(row.latencyMs)
    };
  }
}
