-- Migration 001: Tenants Boundary
-- Establishes the multi-tenant isolation root for the platform.

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL UNIQUE,
    max_budget_usd NUMERIC(8, 4) NOT NULL DEFAULT 5.0000 CHECK (max_budget_usd >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default tenant for local development/testing if it does not already exist
INSERT INTO tenants (id, name, api_key_hash, max_budget_usd)
VALUES (
    'e1f1c7d2-3498-4c1d-84fb-39074742a001',
    'Default Editorial Tenant',
    -- SHA256 of 'default-dev-api-key'
    'a9b465246a3694d18a1362087e0d92c15d42b70fb0c5b9d76832ac08f4bad13b',
    5.0000
)
ON CONFLICT (id) DO NOTHING;
