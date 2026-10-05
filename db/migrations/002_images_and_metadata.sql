-- Migration 002: Images, Structured Metadata, and Vector Embeddings
-- Strictly scoped to tenant with foreign keys and uniqueness constraints.

CREATE TABLE IF NOT EXISTS images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    original_filename TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_images_tenant_url UNIQUE (tenant_id, url)
);

CREATE TABLE IF NOT EXISTS image_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    subject VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    caption TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_image_metadata_tenant_image UNIQUE (tenant_id, image_id)
);

CREATE TABLE IF NOT EXISTS image_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    model_name VARCHAR(64) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    embedding JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_image_vectors_tenant_image UNIQUE (tenant_id, image_id)
);

CREATE INDEX IF NOT EXISTS idx_images_tenant_status ON images(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_images_tenant_created ON images(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metadata_tenant_subject ON image_metadata(tenant_id, subject);
CREATE INDEX IF NOT EXISTS idx_metadata_tenant_category ON image_metadata(tenant_id, category);
