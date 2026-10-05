import pg from 'pg';
import { query } from '../config/database.js';
import { BudgetEvent } from '../models/types.js';

export interface RecordBudgetEventDTO {
  attemptedAction: string;
  currentSpendUsd: number;
  maxBudgetUsd: number;
  message: string;
}

export class BudgetEventRepository {
  async record(
    tenantId: string,
    data: RecordBudgetEventDTO,
    client?: pg.PoolClient | pg.Pool
  ): Promise<BudgetEvent> {
    const sql = `
      INSERT INTO budget_events (tenant_id, attempted_action, current_spend_usd, max_budget_usd, message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tenant_id AS "tenantId", attempted_action AS "attemptedAction",
                current_spend_usd AS "currentSpendUsd", max_budget_usd AS "maxBudgetUsd",
                message, occurred_at AS "occurredAt";
    `;
    const params = [
      tenantId,
      data.attemptedAction,
      data.currentSpendUsd,
      data.maxBudgetUsd,
      data.message
    ];
    const res = await query<BudgetEvent>(sql, params, client);
    const row = res.rows[0];
    if (!row) throw new Error('Failed to record budget event');
    return this.mapRow(row);
  }

  async listRecent(
    tenantId: string,
    limit = 20,
    client?: pg.PoolClient | pg.Pool
  ): Promise<BudgetEvent[]> {
    const sql = `
      SELECT id, tenant_id AS "tenantId", attempted_action AS "attemptedAction",
             current_spend_usd AS "currentSpendUsd", max_budget_usd AS "maxBudgetUsd",
             message, occurred_at AS "occurredAt"
      FROM budget_events
      WHERE tenant_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2;
    `;
    const res = await query<BudgetEvent>(sql, [tenantId, limit], client);
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: BudgetEvent): BudgetEvent {
    return {
      ...row,
      currentSpendUsd: Number(row.currentSpendUsd),
      maxBudgetUsd: Number(row.maxBudgetUsd)
    };
  }
}
