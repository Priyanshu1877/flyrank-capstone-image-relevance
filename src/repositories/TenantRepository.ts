import pg from 'pg';
import { query } from '../config/database.js';
import { Tenant } from '../models/types.js';

export interface CreateTenantDTO {
  name: string;
  apiKeyHash: string;
  maxBudgetUsd?: number;
}

export class TenantRepository {
  async create(data: CreateTenantDTO, client?: pg.PoolClient | pg.Pool): Promise<Tenant> {
    const sql = `
      INSERT INTO tenants (name, api_key_hash, max_budget_usd)
      VALUES ($1, $2, $3)
      RETURNING id, name, api_key_hash AS "apiKeyHash", max_budget_usd AS "maxBudgetUsd",
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const params = [data.name, data.apiKeyHash, data.maxBudgetUsd ?? 5.0];
    const res = await query<Tenant>(sql, params, client);
    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to create tenant record');
    }
    return this.mapRow(row);
  }

  async findById(id: string, client?: pg.PoolClient | pg.Pool): Promise<Tenant | null> {
    const sql = `
      SELECT id, name, api_key_hash AS "apiKeyHash", max_budget_usd AS "maxBudgetUsd",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM tenants
      WHERE id = $1;
    `;
    const res = await query<Tenant>(sql, [id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async findByApiKeyHash(
    apiKeyHash: string,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Tenant | null> {
    const sql = `
      SELECT id, name, api_key_hash AS "apiKeyHash", max_budget_usd AS "maxBudgetUsd",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM tenants
      WHERE api_key_hash = $1;
    `;
    const res = await query<Tenant>(sql, [apiKeyHash], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async updateBudget(
    id: string,
    maxBudgetUsd: number,
    client?: pg.PoolClient | pg.Pool
  ): Promise<Tenant | null> {
    const sql = `
      UPDATE tenants
      SET max_budget_usd = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, api_key_hash AS "apiKeyHash", max_budget_usd AS "maxBudgetUsd",
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await query<Tenant>(sql, [maxBudgetUsd, id], client);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: Tenant): Tenant {
    return {
      ...row,
      maxBudgetUsd: Number(row.maxBudgetUsd)
    };
  }
}
