import { TenantRepository } from '../repositories/TenantRepository.js';
import { AICallRepository, RecordAICallDTO } from '../repositories/AICallRepository.js';
import { BudgetEventRepository } from '../repositories/BudgetEventRepository.js';
import { AICall } from '../models/types.js';

export class BudgetExhaustedError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly currentSpend: number,
    public readonly maxBudget: number
  ) {
    super(
      `AI budget exhausted for tenant ${tenantId}: Current spend $${currentSpend.toFixed(
        4
      )} meets or exceeds budget ceiling $${maxBudget.toFixed(4)}`
    );
    this.name = 'BudgetExhaustedError';
  }
}

export interface BudgetCheckResult {
  allowed: boolean;
  currentSpendUsd: number;
  maxBudgetUsd: number;
  reason?: string;
}

export class BudgetGuardService {
  constructor(
    private readonly tenantRepo = new TenantRepository(),
    private readonly aiCallRepo = new AICallRepository(),
    private readonly budgetEventRepo = new BudgetEventRepository()
  ) {}

  /**
   * Evaluates tenant spend against max_budget_usd before invoking any upstream AI model.
   * If budget is exhausted, records a budget_event and returns allowed: false.
   */
  async checkBudget(tenantId: string, attemptedAction: string): Promise<BudgetCheckResult> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new Error(`Cannot verify AI budget: Tenant ${tenantId} not found`);
    }

    const currentSpendUsd = await this.aiCallRepo.getTenantCumulativeSpend(tenantId);
    const maxBudgetUsd = Number(tenant.maxBudgetUsd);

    if (currentSpendUsd >= maxBudgetUsd) {
      const message = `Budget exhausted ($${currentSpendUsd.toFixed(4)} >= $${maxBudgetUsd.toFixed(
        4
      )}) when attempting '${attemptedAction}'`;

      // Persist auditable event
      await this.budgetEventRepo.record(tenantId, {
        attemptedAction,
        currentSpendUsd,
        maxBudgetUsd,
        message
      });

      return {
        allowed: false,
        currentSpendUsd,
        maxBudgetUsd,
        reason: message
      };
    }

    return {
      allowed: true,
      currentSpendUsd,
      maxBudgetUsd
    };
  }

  /**
   * Asserts that budget is available; throws BudgetExhaustedError if breached.
   */
  async assertBudgetAvailable(tenantId: string, attemptedAction: string): Promise<void> {
    const result = await this.checkBudget(tenantId, attemptedAction);
    if (!result.allowed) {
      throw new BudgetExhaustedError(tenantId, result.currentSpendUsd, result.maxBudgetUsd);
    }
  }

  /**
   * Logs genuine AI invocation telemetry into the auditable ai_calls ledger.
   * Never logs credentials or authorization headers.
   */
  async recordTelemetry(tenantId: string, data: RecordAICallDTO): Promise<AICall> {
    return this.aiCallRepo.record(tenantId, data);
  }
}
