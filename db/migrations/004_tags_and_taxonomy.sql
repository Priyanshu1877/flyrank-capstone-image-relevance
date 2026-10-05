-- Migration 004: Taxonomy Tags and Image Associations
-- Normalized tags scoped by tenant.

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tags_tenant_name UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS image_tags (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, image_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_image_tags_tag_lookup ON image_tags(tenant_id, tag_id);
