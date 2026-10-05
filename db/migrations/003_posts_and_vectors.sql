-- Migration 003: Blog Posts and Post Vector Embeddings
-- Enforces tenant isolation and 1:1 post-to-vector embedding relationship.

CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(256) NOT NULL,
    slug VARCHAR(256) NOT NULL,
    body TEXT NOT NULL,
    primary_category VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_posts_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS post_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    model_name VARCHAR(64) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    embedding JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_post_vectors_tenant_post UNIQUE (tenant_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_tenant_status ON posts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_created ON posts(tenant_id, created_at DESC);
