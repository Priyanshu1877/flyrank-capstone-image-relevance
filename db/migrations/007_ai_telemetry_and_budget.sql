-- Migration 007: AI Usage Telemetry & Cost Budget Events
-- Accurately audits every real AI provider call and logs budget boundary enforcement events.

CREATE TABLE IF NOT EXISTS ai_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Unique call identity per invocation/attempt so retries record real provider consumption
    call_identity VARCHAR(128) NOT NULL UNIQUE,
    operation_id VARCHAR(128) NOT NULL, -- Logical operation grouping (e.g. job_id)
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    task_type VARCHAR(64) NOT NULL CHECK (task_type IN ('vision_metadata', 'text_embedding', 'similarity_eval')),
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000 CHECK (estimated_cost_usd >= 0),
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    status VARCHAR(32) NOT NULL CHECK (status IN ('success', 'failure', 'budget_rejected', 'rate_limited')),
    error_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    attempted_action VARCHAR(64) NOT NULL,
    current_spend_usd NUMERIC(10, 4) NOT NULL,
    max_budget_usd NUMERIC(10, 4) NOT NULL,
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_tenant_created ON ai_calls(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_operation ON ai_calls(tenant_id, operation_id);
CREATE INDEX IF NOT EXISTS idx_budget_events_tenant_time ON budget_events(tenant_id, occurred_at DESC);
