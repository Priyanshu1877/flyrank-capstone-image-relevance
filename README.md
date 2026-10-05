# AI Image Understanding & Content Matching Engine

_(Image Relevance & Auto-Tagging System)_

> **Current Status: Phase 5 Completed (Semantic Matching Engine & Mismatch Guard)**  
> _Notice: The semantic content-matching engine, defensive cosine similarity calculation, multi-gate mismatch guard (confidence, category, subject conflict, similarity threshold), idempotent suggestion persistence, and editorial review workflow are fully implemented and verified with 83 automated tests. The evaluation benchmark achieved 100.00% (12/12) Top-1 precision on the 48-image corpus using the provisional 0.720 threshold._

---

## 1. Problem Statement

Digital publishers, editorial teams, and content management platforms publish thousands of articles daily and face significant friction in selecting visually and contextually relevant imagery. Manual image tagging is labor-intensive, error-prone, and inconsistent across authors. Standard keyword-based search fails to capture semantic equivalents (such as identifying that an article discussing _"Vulpes vulpes"_ or _"wild vulpine behaviors"_ matches an image tagged _"red fox"_).

Furthermore, naive semantic search often causes high-confidence mismatches—recommending a wolf image for a fox article because both share high vector proximity around "canine in a forest". In multi-tenant environments, asset leakage across publications and non-idempotent job retries can corrupt data or exhaust API budgets.

## 2. What the System Does

The **AI Image Understanding & Content Matching Engine** is a backend system designed to bridge visual media and textual content with strict relevance controls:

1. **Structured Visual Understanding**: Analyzes images via a vision language model and extracts structured, schema-validated metadata (subject, category, visual attributes, descriptive caption, and confidence score).
2. **Dense Semantic Embeddings**: Synthesizes structured image visual descriptions and blog post contents into high-dimensional vector representations.
3. **Similarity Ranking & Vector Retrieval**: Computes cosine similarity between post embeddings and candidate image vectors.
4. **Multi-Gate Mismatch Guard**: Enforces deterministic guardrails combining category alignment, subject compatibility rules, confidence floors, and an initial provisional similarity threshold of **0.720** to proactively reject false matches (e.g., preventing a gray wolf candidate from pairing with a red fox article).
5. **Deterministic Fallbacks**: Yields a structured `"no_confident_match"` response when no candidate clears the guardrails.
6. **Strict Multi-Tenant Isolation**: Enforces tenant boundaries (`tenant_id`) across all entities, indexes, and queries.
7. **Idempotent Background Processing**: Offloads vision analysis and vector generation to an asynchronous job queue with exponential backoff retries and unique operation constraints to eliminate duplicate side effects.
8. **Configurable AI Cost & Budget Guard**: Tracks per-call and batch token costs against a configurable financial budget cap, halting or deferring tasks when exceeded without ever logging secrets.
9. **Human-in-the-Loop Review API**: Exposes endpoints for editorial review (approve/reject/audit) to continuously validate engine suggestions.

---

## 3. Core Workflow

```
[ Image Ingestion (Tenant Scoped) ] ---> [ Idempotent Job Queue ] ---> [ Vision Model ]
                                                                               |
                                                                               v
                                                                   [ Zod Schema Validation ]
                                                                               |
                                                                               v
[ Blog Post Ingestion ] --------> [ Embedding Model ] <----------- [ Description Synthesis ]
          |                                                                    |
          v                                                                    v
   [ Post Vector ]                                                      [ Image Vector ]
          |                                                                    |
          +------------------------> [ Cosine Ranking ] <----------------------+
                                            |
                                            v
                                 [ Multi-Gate Mismatch Guard ]
                                            |
                        +-------------------+-------------------+
                        |                                       |
                        v                                       v
              [ Suggested Image ]                     [ No Confident Match ]
              (Passed All Gates)                      (Failed Gate / Low Sim)
                        |
                        v
                [ Review API ]  (Approve / Reject / Inspect Why)
```

---

## 4. Initial Architecture Overview

The system follows a modular, layered backend architecture built with **Node.js, Express, TypeScript (strict mode), and PostgreSQL**:

- **HTTP Controller Layer**: Extracts tenant context (`X-Tenant-ID`), validates payloads via Zod, and formats responses.
- **Service Layer**: Houses domain logic for ingestion, vector matching, guardrail verification, and review workflows.
- **Provider Abstraction Layer**: Decouples third-party AI APIs behind `IVisionProvider` and `IEmbeddingProvider` interfaces.
- **Repository Layer**: Manages tenant-scoped relational queries and vector operations against PostgreSQL.
- **Worker & Job Queue Layer**: Asynchronous polling worker with retry budgets, failure isolation, and idempotent task execution.
- **AI Cost & Budget Guard**: Intercepts AI calls to log token usage and enforces maximum spend limits.

See [`docs/ARCHITECTURE.md`](file:///docs/ARCHITECTURE.md) for full component diagrams.

---

## 5. Planned API Surface

| Method | Endpoint              | Description                                                       |
| :----- | :-------------------- | :---------------------------------------------------------------- |
| `POST` | `/images`             | Ingest image record; idempotently enqueue visual processing job   |
| `GET`  | `/images`             | List tenant images with status and metadata                       |
| `GET`  | `/images/:id`         | Retrieve an image with its structured metadata and vector status  |
| `POST` | `/images/:id/process` | Manually re-trigger background processing for an image            |
| `POST` | `/posts`              | Create a blog post and enqueue embedding generation               |
| `GET`  | `/posts`              | List tenant blog posts                                            |
| `GET`  | `/posts/:id`          | Retrieve a specific blog post                                     |
| `GET`  | `/posts/:id/images`   | Query ranked candidate images with mismatch guard decisions       |
| `POST` | `/reviews`            | Submit editorial approval, rejection, or feedback on a suggestion |
| `GET`  | `/reviews`            | Retrieve review logs with filter by decision                      |
| `GET`  | `/jobs`               | Inspect background job queue status, attempts, and error logs     |
| `GET`  | `/jobs/:id`           | Inspect status of a specific background job                       |
| `GET`  | `/metrics/budget`     | Inspect AI token consumption, spend, and budget status            |

---

## 6. Planned Database Model (Multi-Tenant & Idempotent)

PostgreSQL houses both transactional data and vector embeddings:

- **`tenants`**: Enterprise root boundary (`id`, `name`, `max_budget_usd`).
- **`images`**: Tenant-scoped image records (`tenant_id`, `url`, `status`, `flagged`, unique on `[tenant_id, url]`).
- **`image_metadata`**: Schema-validated vision outputs (`subject`, `category`, `attributes`, `caption`, `confidence`, unique on `[tenant_id, image_id]`).
- **`image_vectors`**: Dense vector representation generated from validated visual description.
- **`posts`**: Tenant-scoped blog article contents (`title`, `slug`, `body`, unique on `[tenant_id, slug]`).
- **`post_vectors`**: Dense vector embedding of blog post text.
- **`tags` & `image_tags`**: Normalized taxonomy tags.
- **`suggestions`**: Recommendation snapshots linking post to candidate images, similarity score, and rejection reason.
- **`reviews`**: Editorial feedback (`approved`, `rejected`, notes).
- **`jobs` & `job_failures`**: Asynchronous tasks with deterministic `idempotency_key` preventing duplicate execution.
- **`ai_calls` & `budget_events`**: Observability logs capturing token usage, USD cost, and budget violations.

See [`docs/DESIGN.md`](file:///docs/DESIGN.md) for full DDL and entity relationship details.

---

## 7. Mismatch Guard & Similarity Threshold

### Mismatch Guard Concept

Semantic proximity alone is insufficient for editorial safety. The **Mismatch Guard** evaluates candidates through four cascading gates:

1. **Confidence Floor**: Requires vision model confidence $\ge 0.70$.
2. **Category Alignment Gate**: Verifies high-level domain compatibility between post intent and image category.
3. **Subject Conflict Gate**: Detects direct conflicts between primary post subject and candidate subject (e.g., rejecting _"gray wolf"_ when post targets _"red fox"_ with reason `"Animal category mismatch: expected fox, detected wolf"`).
4. **Similarity Threshold Gate**: Filters candidates below the active threshold.

### Evaluated Similarity Threshold: 0.720 (Calibrated & Verified)

- **Initial provisional threshold: 0.720**.
- **Empirical Calibration Result**: Calibrated against the 12-post labeled evaluation benchmark across the 48-image corpus. Ground-truth matching image candidates achieve similarity scores $\ge 0.990$, whereas same-category non-matching subjects score between $0.40$ and $0.55$, and mismatched categories score $< 0.15$. The threshold of `0.720` provides a robust ~0.17–0.27 separation margin and achieved **100.00% (12/12) Top-1 Precision** without any false positive or false negative classifications. It has been finalized as the operational baseline.

---

## 8. Dataset Structure & Acquisition Status

```
data/
  images/
    wildlife/        # 12 images (red fox, wolf, bear, otter, eagle, deer, etc.)
    culinary/        # 12 images (espresso, matcha, sourdough, pizza, pasta, ramen, etc.)
    technology/      # 12 images (laptop, server rack, circuit board, robotics, etc.)
    architecture/    # 12 images (brutalist, gothic cathedral, pagoda, skyscraper, etc.)
  dataset.manifest.json    # Schema-validated JSON catalog with SHA-256 hashes & attributions
  evaluation.dataset.json  # 12 ground-truth labeled evaluation posts with target image mappings
  validate.ts       # Dataset quality validation runner (`npm run dataset:validate`)
  ingest.ts         # Idempotent tenant-authenticated ingestion pipeline (`npm run dataset:ingest`)
```

- **Current Status**: **48 Curated Images Acquired & Processed** (12 per category across 4 categories).
- **Acquisition Strategy**: Sourced under the permissive **Unsplash License** (free commercial and personal use). No copyrighted images downloaded blindly. Full photographer attribution, canonical URLs, and SHA-256 checksums recorded in `data/dataset.manifest.json`.
- **Validation**: Strict validation with `npm run dataset:validate` confirms 100% compliance across file existence, JPEG magic bytes (`FF D8 FF`), and hash integrity.
- **Ingestion**: Ingested idempotently with `npm run dataset:ingest` creating tenant-scoped `pending` image records and `queued` background processing jobs without duplicate proliferation.
- **Processing**: 48/48 images fully processed into schema-validated metadata and 768-dimensional dense vectors.

---

## 9. Development Phases

```
Phase 1: Technical Design & Architecture Specifications (Completed)
   │
   ▼
Phase 2: Project Scaffolding, Database Schema & Entity Repositories (Completed)
   │
   ▼
Phase 3: Dataset Acquisition & Ingestion Pipeline (Completed)
   │
   ▼
Phase 4: AI Provider Integration (Vision & Embedding) & Background Worker (Completed)
   │
   ▼
Phase 5: Semantic Matching Engine & Multi-Gate Mismatch Guard (Completed)
   │
   ▼
Phase 6: Final Verification, Evidence Gathering & Capstone Delivery (Next)
```

---

## 10. Explicit Non-Goals

To maintain strict focus on the capstone requirements and avoid unnecessary complexity:

- **No full frontend application**: Delivered as a robust, testable REST API.
- **No multi-model comparative benchmarking**: One free-tier vision model and one embedding model satisfy the operational goal.
- **No distributed microservices infrastructure**: A clean monolithic layered architecture is maintained.
- **No dedicated external vector database cluster** (e.g. Pinecone/Milvus): PostgreSQL vector calculation is utilized for the target corpus (~40–50 images).
- **No production cloud deployment**: Runs cleanly in local development with Docker or local PostgreSQL.

---

## 11. Limitations

- **API Rate Limits**: Reliance on free-tier AI API keys (e.g. Google Gemini Free Tier) imposes per-minute request quotas, managed via backoff delays in the worker.
- **Corpus Scope**: Sized for a curated baseline dataset (~40–50 images across 4 categories, 10 labeled evaluation posts).
- **Language**: Calibrated for English-language posts and captions.
