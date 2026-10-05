-- Migration 005: Suggestions & Editorial Reviews
-- Stores ranked candidate recommendations and human-in-the-loop review feedback.

CREATE TABLE IF NOT EXISTS suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_id UUID REFERENCES images(id) ON DELETE SET NULL,
    similarity_score NUMERIC(5, 4) NOT NULL,
    rank INTEGER NOT NULL CHECK (rank >= 1),
    guard_passed BOOLEAN NOT NULL,
    rejection_reason TEXT,
    guard_details JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'no_confident_match')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suggestions_tenant_post_image UNIQUE (tenant_id, post_id, image_id)
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    decision VARCHAR(32) NOT NULL CHECK (decision IN ('approved', 'rejected', 'modified')),
    notes TEXT,
    reviewer_id VARCHAR(64) DEFAULT 'editorial_team',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suggestions_tenant_post ON suggestions(tenant_id, post_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_suggestion ON reviews(tenant_id, suggestion_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_decision ON reviews(tenant_id, decision);
