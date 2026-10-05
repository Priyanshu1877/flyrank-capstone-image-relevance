-- Migration 006: Asynchronous Jobs and Failure Tracking
-- Backs background execution with deterministic idempotency keys and failure logs.

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    type VARCHAR(64) NOT NULL CHECK (type IN ('PROCESS_IMAGE', 'GENERATE_POST_EMBEDDING', 'REINDEX_VECTORS')),
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'deferred', 'budget_rejected')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_jobs_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS job_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status_sched ON jobs(tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_job_failures_tenant_job ON job_failures(tenant_id, job_id);
