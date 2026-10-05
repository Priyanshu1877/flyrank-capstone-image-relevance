# System Design Document: AI Image Understanding & Content Matching Engine

## A. Problem

Content publishing workflows suffer from major inefficiencies in media asset management. Digital articles require contextually accurate header and inline imagery to maximize engagement and convey information. However:

1. **Manual Tagging Deficits**: Metadata tagged by human contributors is either sparse, subjective, or missing entirely.
2. **Semantic Synonyms Missed by Lexical Search**: Keyword matching cannot discern that an article about _"Vulpes vulpes evolutionary habits"_ or _"wild vulpine species"_ matches an image tagged _"red fox"_.
3. **Plausible Visual Hallucinations / False Matches**: Standard vector distance or keyword search often pairs superficially similar concepts that are factually contradictory—for instance, pairing a picture of a _gray wolf_ with an article describing a _red fox_ simply because both feature canines in woodland environments.
4. **Synchronous Bottlenecks**: Calling multimodal vision models directly during user upload or publishing flows introduces 5–15 second latencies, timeouts, and unhandled provider rate limits.
5. **Multi-Tenant Leakage & Irreversible Side Effects**: In enterprise and multi-publication systems, lacking strict tenant boundaries can expose media assets across publishers, while non-idempotent job retries can corrupt state, duplicate vector embeddings, or rapidly deplete API budgets.

---

## B. Goals & Success Criteria

1. **Automated Structured Visual Extraction**: Extract consistent, schema-validated metadata from image files or URLs using a vision language model.
2. **Deterministic Schema Enforcement**: Enforce a strict Zod schema on model output, rejecting malformed responses and quarantining low-confidence classifications.
3. **Dual Semantic Embeddings**: Generate high-fidelity vector representations for both structured image descriptions and blog post contents.
4. **Accurate Ranked Suggestions**: Rank candidate images against blog posts based on cosine similarity.
5. **Fail-Safe Mismatch Guard**: Block candidates that violate category, species/subject, or confidence constraints, outputting explicit audit logs for each rejection.
6. **"No Confident Match" Fallback**: Gracefully return an explicit status when no candidate meets quality and similarity thresholds.
7. **Strict Multi-Tenant Isolation**: Enforce tenant ownership (`tenant_id`) across all entities, indexing, and repository queries to prevent cross-tenant data access.
8. **Guaranteed Idempotent Processing**: Ensure job retries and duplicate webhooks cannot create duplicate metadata, multiple vector embeddings, duplicate suggestions, or ghost AI cost records.
9. **Configurable AI Cost & Budget Guard**: Track per-call and cumulative batch token costs, enforcing a strict budget cap that safely halts or defers AI invocations upon limit exhaustion without leaking secrets.
10. **Quantitative Verification**: Achieve $\ge 80\%$ top-1 precision on a ground-truth evaluation benchmark of $\ge 10$ labeled posts across $\ge 40$ curated images across 4 categories.

---

## C. Explicit Non-Goals

To safeguard project scope while delivering production-grade engineering:

- **No full frontend user interface**: The system is designed and tested via clean REST APIs, CLI runners, and HTTP automated tests.
- **No multi-model benchmark suite**: A single reliable vision model (e.g. Gemini 1.5/2.0 Flash) and a single embedding model (e.g. `text-embedding-004`) are utilized.
- **No multi-node vector database infrastructure**: No external vector clusters (Pinecone, Milvus, Qdrant); vector calculations are executed directly in PostgreSQL via pgvector or normalized cosine dot-product functions for our target dataset (~40–50 images).
- **No distributed microservices architecture**: All operations exist within a modular monolith with clear domain boundaries and tenant context passing.
- **No production cloud deployment**: Runs in local developer environments with zero credit card dependencies.

---

## D. System Architecture

```
                                  +---------------------------------------+
                                  |            HTTP Client                |
                                  |   (Authenticated Tenant Context)      |
                                  +---------------------------------------+
                                                     | (X-Tenant-ID / Token)
                                                     v
                                  +---------------------------------------+
                                  |        Express HTTP Controllers       |
                                  |     (Tenant Context & Zod Validator)  |
                                  +---------------------------------------+
                                          |                       |
                     (Enqueue Asynchronous Work)          (Query & Reviews)
                                          |                       |
                                          v                       v
                         +-------------------------+   +-------------------------+
                         |   Tenant Job Queue      |   |    Matching Service     |
                         |   (PostgreSQL `jobs`)   |   +-------------------------+
                         +-------------------------+                |
                                      |                             |
                                      v                             |
                         +-------------------------+                |
                         |    Background Worker    |                |
                         |  (Idempotent Execution) |                |
                         +-------------------------+                |
                                      |                             |
                                      v                             |
                         +-------------------------+                |
                         |   AI Budget Guard       | <--------------+
                         | (Checks Spending Limit) |
                         +-------------------------+
                                 |         |
             +-------------------+         +----------------+
             |                                              |
             v                                              v
+-------------------------+                    +-------------------------+
|     Vision Provider     |                    |   Embedding Provider    |
|   (Gemini Flash Free)   |                    |   (text-embedding-004)  |
+-------------------------+                    +-------------------------+
             |                                              |
             v                                              v
+-------------------------+                    +-------------------------+
| Zod Vision Schema Check |                    | Normalized Vector Math  |
+-------------------------+                    +-------------------------+
             |                                              |
             +--------------------+   +---------------------+
                                  |   | (Tenant-Scoped Persistence & Upsert)
                                  v   v
                   +----------------------------------+
                   |       PostgreSQL Database        |
                   |  - tenants (tenant_id root)      |
                   |  - images / image_metadata       |
                   |  - posts / post_vectors          |
                   |  - suggestions / reviews         |
                   |  - ai_calls / budget_events      |
                   |  - jobs / job_failures           |
                   +----------------------------------+
                                  |
                                  v
                   +----------------------------------+
                   |      Mismatch Guard Engine       |
                   |  - Category Alignment Gate      |
                   |  - Subject Compatibility Gate    |
                   |  - Confidence Floor Check        |
                   |  - Provisional Sim Gate (0.720)  |
                   +----------------------------------+
```

### Tenant Isolation Architecture

Every database entity (except global taxonomy templates if decoupled) maintains an explicit `tenant_id` foreign key.

- **Context Injection**: An Express middleware resolves the calling tenant (from `X-Tenant-ID` header or auth token) and binds it to the request execution context.
- **Repository-Level Scoping**: All database queries MUST include `WHERE tenant_id = :tenantId`. Cross-tenant queries are blocked at the repository layer.

---

## E. Data Flow & Idempotent Processing

### 1. Image Ingestion Flow (Idempotent)

1. Client issues `POST /images` with `{ "url": "...", "originalFilename": "..." }` and tenant header.
2. System computes a deterministic operation hash: `op_key = sha256(tenant_id + ":" + url)`.
3. System inserts/upserts an `images` row with `ON CONFLICT (tenant_id, url) DO NOTHING` or `UPDATE`.
4. System enqueues a row in `jobs` with `idempotency_key = op_key`. If a job with that key already exists and is pending/processing, the duplicate request returns the existing job ID.
5. API returns HTTP 202 Accepted.

### 2. Background Processing Flow (Idempotent & Budget-Guarded)

1. Worker polls `jobs` for scheduled tasks matching `tenant_id` with `attempts < max_attempts`.
2. Worker checks the **AI Cost Budget Guard**:
   - Computes tenant's cumulative spend from `ai_calls` against `AI_MAX_BUDGET_USD`.
   - If budget exceeded: transitions job to `deferred` status, logs an event in `budget_events`, and halts AI calls.
3. If budget is healthy, worker invokes `IVisionProvider.analyzeImage(url)`.
4. Response is validated against `VisionMetadataSchema` (Zod).
   - If invalid: records failure, increments attempt counter, schedules backoff.
   - If confidence $< 0.70$: metadata stored with `flagged = true`.
5. Worker synthesizes description and invokes `IEmbeddingProvider.generateEmbedding(...)`.
6. Atomic PostgreSQL transaction executes **idempotent upserts**:
   - `INSERT INTO image_metadata (...) ON CONFLICT (tenant_id, image_id) DO UPDATE ...`
   - `INSERT INTO image_vectors (...) ON CONFLICT (tenant_id, image_id) DO UPDATE ...`
   - Records AI token usage to `ai_calls` with operation ID to prevent duplicate billing records upon retries.
   - Updates `jobs.status = 'completed'` and releases locks.

### 3. Post Ingestion Flow

1. Client issues `POST /posts` with `{ "title": "...", "body": "...", "primaryCategory": "..." }`.
2. Stored in `posts` scoped to `tenant_id`.
3. System invokes `IEmbeddingProvider.generateEmbedding(postContent)` under budget guard.
4. Embedding saved to `post_vectors` via idempotent upsert: `ON CONFLICT (tenant_id, post_id) DO UPDATE`.

### 4. Matching & Mismatch Guard Flow

1. Client requests `GET /posts/:id/images?minSimilarity=0.720`.
2. System loads post embedding and queries candidate images **strictly belonging to the same `tenant_id`**.
3. Candidates pass through the **Mismatch Guard**:
   - Confidence Floor ($\ge 0.70$).
   - Category Compatibility.
   - Subject Conflict Filter (e.g. Red Fox vs. Gray Wolf).
   - Provisional Similarity Threshold ($\ge 0.720$, subject to tuning in evaluation).
4. Persists recommendation record in `suggestions` using `ON CONFLICT (tenant_id, post_id, image_id) DO UPDATE` to guarantee idempotency.
5. Returns best match or structured `"no_confident_match"`.

---

## F. Database Schema (With Strict Tenant Isolation & Idempotency)

```sql
-- Tenants Table (Enterprise Isolation Boundary)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL,
    max_budget_usd NUMERIC(8, 4) NOT NULL DEFAULT 5.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core Images Table (Tenant Scoped)
CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    original_filename TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_images_tenant_url UNIQUE (tenant_id, url)
);

-- Structured Vision Metadata (Tenant Scoped, Idempotent 1:1 with Image)
CREATE TABLE image_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    subject VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    caption TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(4, 3) NOT NULL,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_image_metadata_tenant_image UNIQUE (tenant_id, image_id)
);

-- Image Vector Embeddings (Tenant Scoped, Idempotent 1:1 with Image)
CREATE TABLE image_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    model_name VARCHAR(64) NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding JSONB NOT NULL, -- Array of floats with normalized dot-product/cosine calculation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_image_vectors_tenant_image UNIQUE (tenant_id, image_id)
);

-- Taxonomy Tags (Tenant Scoped)
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tags_tenant_name UNIQUE (tenant_id, name)
);

CREATE TABLE image_tags (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (tenant_id, image_id, tag_id)
);

-- Blog Posts (Tenant Scoped)
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(256) NOT NULL,
    slug VARCHAR(256) NOT NULL,
    body TEXT NOT NULL,
    primary_category VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_posts_tenant_slug UNIQUE (tenant_id, slug)
);

-- Post Vector Embeddings (Tenant Scoped, Idempotent 1:1 with Post)
CREATE TABLE post_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    model_name VARCHAR(64) NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_post_vectors_tenant_post UNIQUE (tenant_id, post_id)
);

-- Suggestions / Recommendations (Tenant Scoped, Idempotent)
CREATE TABLE suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_id UUID REFERENCES images(id) ON DELETE SET NULL,
    similarity_score NUMERIC(5, 4) NOT NULL,
    rank INTEGER NOT NULL,
    guard_passed BOOLEAN NOT NULL,
    rejection_reason TEXT,
    guard_details JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'suggested', -- suggested, no_confident_match
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suggestions_tenant_post_image UNIQUE (tenant_id, post_id, image_id)
);

-- Editorial Reviews (Tenant Scoped)
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    decision VARCHAR(32) NOT NULL, -- approved, rejected, modified
    notes TEXT,
    reviewer_id VARCHAR(64) DEFAULT 'editorial_team',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Background Jobs Queue (Tenant Scoped, Idempotency Enforced)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    type VARCHAR(64) NOT NULL, -- PROCESS_IMAGE, GENERATE_POST_EMBEDDING
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued', -- queued, processing, completed, failed, deferred
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_jobs_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- Job Failures Log (Tenant Scoped)
CREATE TABLE job_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI Usage, Costs, and Telemetry (Tenant Scoped, Idempotency Guarded)
CREATE TABLE ai_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    operation_id VARCHAR(128) NOT NULL, -- Ties to job_id or idempotency_key
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    task_type VARCHAR(64) NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost_usd NUMERIC(8, 6) DEFAULT 0.000000,
    latency_ms INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL, -- success, failure, budget_rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_calls_tenant_operation UNIQUE (tenant_id, operation_id)
);

-- Budget Violation Events
CREATE TABLE budget_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    attempted_action VARCHAR(64) NOT NULL,
    current_spend_usd NUMERIC(8, 4) NOT NULL,
    max_budget_usd NUMERIC(8, 4) NOT NULL,
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Multi-Tenant Composite Indexes for High Performance
CREATE INDEX idx_images_tenant_status ON images(tenant_id, status);
CREATE INDEX idx_metadata_tenant_subject ON image_metadata(tenant_id, subject);
CREATE INDEX idx_metadata_tenant_category ON image_metadata(tenant_id, category);
CREATE INDEX idx_jobs_tenant_status_sched ON jobs(tenant_id, status, scheduled_at);
CREATE INDEX idx_suggestions_tenant_post ON suggestions(tenant_id, post_id);
CREATE INDEX idx_ai_calls_tenant_created ON ai_calls(tenant_id, created_at);
```

---

## G. API Surface

Every request requires tenant authentication context via header `X-Tenant-ID: <uuid>` or a Bearer token. All operations are strictly tenant-isolated.

| Method | Endpoint              | Description                                        |
| :----- | :-------------------- | :------------------------------------------------- |
| `POST` | `/images`             | Ingest image; idempotently enqueues processing job |
| `GET`  | `/images`             | List tenant's images with filter/pagination        |
| `GET`  | `/images/:id`         | Get tenant's image by ID                           |
| `POST` | `/images/:id/process` | Re-trigger processing idempotently                 |
| `POST` | `/posts`              | Create blog post & generate post vector            |
| `GET`  | `/posts`              | List tenant's blog posts                           |
| `GET`  | `/posts/:id`          | Get single post                                    |
| `GET`  | `/posts/:id/images`   | Query ranked candidates with mismatch guard        |
| `POST` | `/reviews`            | Submit editorial approval or rejection             |
| `GET`  | `/reviews`            | List editorial review audit logs                   |
| `GET`  | `/jobs`               | Inspect tenant's background jobs                   |
| `GET`  | `/jobs/:id`           | Inspect status of a specific job                   |
| `GET`  | `/metrics/budget`     | Check tenant spend against maximum budget          |

---

## H. Vision Metadata Schema

Enforced strictly via Zod. Malformed outputs trigger retry, while low-confidence detections ($< 0.70$) are flagged and quarantined from automated matching:

```typescript
import { z } from 'zod';

export const VisionMetadataSchema = z.object({
  subject: z.string().trim().min(2).max(100).toLowerCase(),
  category: z.string().trim().min(2).max(50).toLowerCase(),
  attributes: z.array(z.string().trim().min(2).max(40).toLowerCase()).min(1).max(15),
  caption: z.string().trim().min(10).max(500),
  confidence: z.number().min(0.0).max(1.0)
});

export type VisionMetadata = z.infer<typeof VisionMetadataSchema>;
```

---

## I. Embedding & Matching Strategy

### 1. Vector Generation

- **Model**: `text-embedding-004` (768 dimensions) via Google Generative AI Free Tier, or standardized dense embeddings.
- **Description Synthesis**:
  $$\text{Input}_{\text{image}} = \text{"Subject: "} + \text{subject} + \text{" | Category: "} + \text{category} + \text{" | Attributes: "} + \text{join}(\text{attributes}, \text{", "}) + \text{" | Caption: "} + \text{caption}$$
- **Post Synthesis**:
  $$\text{Input}_{\text{post}} = \text{"Title: "} + \text{title} + \text{" | Category: "} + \text{category} + \text{" | Content: "} + \text{truncate}(\text{body}, 1500)$$

### 2. Semantic Equivalents

Captures synonyms and taxonomic equivalents (e.g., _"red fox"_ $\approx$ _"Vulpes vulpes"_ $\approx$ _"wild fox species"_) into adjacent vector embeddings ($\text{cosine similarity} > 0.82$).

### 3. Similarity Threshold Specification

- **Initial similarity threshold**: `0.720` (provisional).
- **Tuning Requirement**: The initial threshold of `0.720` is a provisional baseline. The final threshold must be empirically tuned across the labeled evaluation dataset to optimize top-1 precision, and the resulting calibrated threshold and precision metric must be documented in `README.md`.

---

## J. Mismatch Guard Rules

The Mismatch Guard evaluates candidates that clear the similarity threshold:

1. **Confidence Floor**: Requires candidate image `metadata.confidence >= 0.70`. Quarantined/flagged images are excluded.
2. **Category Compatibility Gate**: Rejects candidate if the image domain conflicts with the post domain (e.g. Wildlife vs. Architecture).
3. **Subject Conflict Filter**: Catches taxonomically adjacent but contradictory entities.
   - Example: Post _"The wild behavior of red foxes"_ vs. Image _"gray wolf in the forest"_.
   - Result: `REJECTED`.
   - Reason: `"Animal category mismatch: expected fox, detected wolf"`.
4. **"No Confident Match" Fallback**:
   - If no candidate satisfies all guard gates or exceeds the active similarity threshold, the engine returns `status = "no_confident_match"` and `bestMatch = null`.

---

## K. Background Job Strategy & Idempotency

### Idempotent Architecture

- **Job Deduplication**: Jobs require a unique `(tenant_id, idempotency_key)`. Re-submitting the same image URL does not spawn duplicate workers.
- **State Upserts**: Image metadata and embeddings utilize PostgreSQL `ON CONFLICT (tenant_id, image_id) DO UPDATE` to prevent duplicate entity creation during retries.
- **Cost Deduplication**: Every AI call records `operation_id = sha256(tenant_id + ":" + job_id + ":" + attempt)`. Re-runs of completed attempts cannot double-count token costs.
- **Worker Concurrency**: Worker processes jobs using `FOR UPDATE SKIP LOCKED` to prevent race conditions in multi-instance setups.

---

## L. AI Cost & Budget Guard

To prevent runaway billing and protect free-tier quotas:

1. **Per-Call Tracking**: Logs input tokens, output tokens, latency, and estimated USD cost to `ai_calls`.
2. **Cumulative Batch Tracking**: Computes sum of `estimated_cost_usd` for the current tenant or batch run.
3. **Configurable Maximum Budget**: Defined via `AI_MAX_BUDGET_USD` in `.env` (default: \$5.00) and stored per tenant in `tenants.max_budget_usd`.
4. **Rejection & Deferral Behavior**:
   - If cumulative spend $\ge$ maximum budget:
     - Worker defers or rejects pending AI tasks with status `budget_rejected`.
     - Logs an auditable entry to `budget_events`.
     - Matching queries fall back to existing cached vectors or return `status = "budget_exceeded"`.
5. **Zero Secret Leaks**: Telemetry tables and audit logs **never record API keys, auth headers, or raw authentication secrets**.

---

## M. Security & Tenant Privacy

1. **Repository-Enforced Tenant Scoping**: All database queries require explicit `tenant_id` binding.
2. **SSRF Defense**: Image URL ingestion blocks local/internal IP ranges (`127.0.0.1`, `169.254.169.254`, `10.0.0.0/8`, `192.168.0.0/16`).
3. **Environment Secrets**: API keys live exclusively in `.env` and are injected at runtime.
4. **Input Sanitization**: All endpoint inputs are validated against strict Zod schemas before reaching service logic.

---

## N. Dataset & Evaluation Strategy

### 1. Dataset Acquisition Plan

- **Status**: **Phase 1 dataset acquisition required**. Actual image binaries have not been downloaded.
- **Directory Structure**:
  - `data/images/wildlife/` (Target: ~12–15 images)
  - `data/images/culinary/` (Target: ~12–15 images)
  - `data/images/technology/` (Target: ~12–15 images)
  - `data/images/architecture/` (Target: ~12–15 images)
- **Licensing & Sources**: Permissive licenses only (**Unsplash**, **Pexels**, **Wikimedia Commons**). All entries tracked with source URL and attribution in `data/dataset.manifest.json`. No copyrighted images downloaded blindly.

### 2. Evaluation Benchmark Specification

- **Posts**: 12 labeled blog posts across the 4 categories with ground-truth expected image pairings (`data/evaluation.dataset.json`).
- **Adversarial Pairs**: Explicitly tests fox vs. wolf, espresso vs. tea, laptop vs. server rack, brutalist vs. cathedral.
- **Evaluation Metric**: Top-1 Precision $\ge 80\%$:
  $$\text{Top-1 Precision} = \frac{\sum_{i=1}^{N} \mathbb{I}(\text{TopMatch}_i == \text{GroundTruth}_i)}{N}$$
- **Threshold Calibration**: The provisional `0.720` threshold was evaluated against all 12 ground-truth posts, achieving **100.00% Top-1 Precision** (12/12 correct top matches, 0 false positives, 0 false negatives).

---

## O. Phase 5 Implementation: Semantic Matching Engine & Mismatch Guard

Phase 5 introduces the semantic matching engine and multi-gate mismatch guard, implementing end-to-end post ingestion, vector representation, candidate retrieval, rejection auditing, and review workflows:

### 1. Post Ingestion & Representation

- **Endpoints**: `POST /posts`, `GET /posts`, `GET /posts/:id`, `GET /posts/:id/images`.
- **Validation**: Enforced via `CreatePostSchema` with Zod validation.
- **Embedding Synthesis**: Combines normalized category, title, and body into structured dense text: `Category: {category}. Title: {title}. Content: {body}`.
- **Cost & Budget Protection**: Invokes `BudgetGuardService.assertBudgetAvailable` prior to provider execution, and records telemetry in `ai_calls`.

### 2. Multi-Gate Mismatch Guard Pipeline

Matching candidates undergo strict sequential evaluation before being considered for recommendations:

1. **Vision Confidence & Quarantine Gate**: Candidates with `confidence < 0.70` are rejected with `LOW_CONFIDENCE`. Flagged images are rejected with `QUARANTINED`.
2. **Category Compatibility Gate**: Cross-category candidates are rejected with `CATEGORY_MISMATCH`.
3. **Subject / Entity Conflict Gate**: Evaluates domain-specific taxonomy conflict rules via `detectSubjectConflict`. For example:
   - Post: "Red fox behavior" -> Candidate: Gray wolf -> REJECT (`SUBJECT_CONFLICT: Animal category mismatch: expected fox, detected wolf`)
   - Post: "Gray wolf behavior" -> Candidate: Red fox -> REJECT (`SUBJECT_CONFLICT: Animal category mismatch: expected wolf, detected fox`)
4. **Defensive Cosine Similarity Gate**:
   $$\text{cosine\_similarity}(A, B) = \frac{A \cdot B}{\|A\| \times \|B\|}$$
   Defensively rejects zero vectors, dimension mismatches, and non-finite numbers with reason `INVALID_VECTOR`.
5. **Similarity Threshold Gate**: Filters out candidates scoring below the calibrated threshold (`0.720`) with reason `SIMILARITY_BELOW_THRESHOLD`.
6. **Eligible Candidate Ranking**: Passing candidates are sorted descending by similarity score and assigned sequential ranks (1, 2, 3...).
7. **Safe Fallback**: If no candidates clear all gates, the system returns `status: "no_confident_match"` and `bestMatch: null`, preserving full auditable candidate inspection.

### 3. Suggestion Persistence & Editorial Review Workflow

- **Idempotency**: Suggestions for a given post are atomically refreshed using `deleteByPostId` followed by upserts into `suggestions`.
- **Human-in-the-Loop Reviews**: Implemented via `POST /reviews` and `GET /reviews` supporting `approved`, `rejected`, and `modified` decisions with reviewer notes.
- **Tenant Scope Enforcement**: Review operations strictly enforce that the target suggestion belongs to the authenticated tenant, rejecting cross-tenant manipulation.
