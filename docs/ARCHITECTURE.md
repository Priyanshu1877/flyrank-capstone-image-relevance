# Architecture Specification: AI Image Understanding & Content Matching Engine

## 1. High-Level Architecture Overview

The system is structured as a modular monolithic backend designed around **multi-tenant domain separation**, asynchronous background job processing with guaranteed **idempotency**, a **configurable AI budget guard**, and pluggable AI providers.

### End-to-End System Workflow

```
   [ External Images ]
           |
           v (Authenticated Tenant Context)
   +---------------+
   | POST /images  |
   +---------------+
           |
           v (Enqueues Job with Idempotency Key)
   +------------------------------------+
   |   PostgreSQL Jobs Table (`jobs`)   | <---+
   +------------------------------------+     |
           |                                  |
           v (Polls queued jobs per tenant)   |
   +------------------------------------+     |
   |      Asynchronous Background       |     |
   |              Worker                |     |
   +------------------------------------+     |
           |                                  |
           v                                  |
   +------------------------------------+     |
   |          AI Budget Guard           |     |
   |  (Halts/Defers if Budget Exceeded) |     |
   +------------------------------------+     |
           |                                  |
           v                                  |
   +------------------------------------+     |
   |      Vision Model Provider         |     |
   |     (Google Gemini / Local)        |     |
   +------------------------------------+     |
           |                                  |
           v                                  |
   +------------------------------------+     |
   |     Structured Vision Metadata     |     |
   +------------------------------------+     |
           |                                  |
           +-----------> [ Zod Validation ] --+ (If Invalid -> Retry / Failure)
           |
           +-----------> [ Description Synthesis ]
                               |
                               v
                     +--------------------+
                     |  Embedding Model   |
                     |     Provider       |
                     +--------------------+
                               |
                               v (Idempotent Upsert)
                     +--------------------+
                     |   Image Vectors    |
                     |  (`image_vectors`) |
                     +--------------------+

   [ Blog Post Ingestion (Tenant Scoped) ]
           |
           v
   +---------------+
   |  POST /posts  |
   +---------------+
           |
           v
   +--------------------+
   |  Post Embedding    |
   |     Provider       |
   +--------------------+
           |
           v (Idempotent Upsert)
   +--------------------+
   |    Post Vectors    |
   |  (`post_vectors`)  |
   +--------------------+
           |
           +---------------------------------------------+
                                                         |
                                                         v
   [ Candidate Ranking & Guardrail Execution ]   +--------------------+
                                                 | Cosine Similarity  |
                                                 | Ranking (in Tenant)|
                                                 +--------------------+
                                                         |
                                                         v
                                                 +--------------------+
                                                 |   Mismatch Guard   |
                                                 |  - Category Gate   |
                                                 |  - Subject Gate    |
                                                 |  - Confidence Floor|
                                                 |  - Provisional Sim |
                                                 |    Gate (0.720)    |
                                                 +--------------------+
                                                         |
                                 +-----------------------+-----------------------+
                                 |                                               |
                                 v                                               v
                      +----------------------+                       +----------------------+
                      |   Suggested Image    |                       | No Confident Match   |
                      |  (Passed All Gates)  |                       | (Failed Gate / Under |
                      +----------------------+                       |      Threshold)      |
                                 |                                   +----------------------+
                                 v                                               |
                      +----------------------+                                   |
                      |   Suggestions Log    | <---------------------------------+
                      | (Idempotent Upsert)  |
                      +----------------------+
                                 |
                                 v
                      +----------------------+
                      |      Review API      |
                      | (Approve / Reject /  |
                      |     Audit Why)       |
                      +----------------------+
```

---

## 2. Layered Component Boundaries & Tenant Isolation

```
+---------------------------------------------------------------------------------+
|                                 HTTP Layer                                      |
|  - Express Application (src/app.ts)                                             |
|  - Tenant Context Middleware (Extracts & Validates X-Tenant-ID)                  |
|  - Routers (src/routes/*.ts)                                                    |
|  - Controllers (src/controllers/*.ts)                                           |
|  - Request Body / Query Validation via Zod Schemas (src/schemas/api.ts)         |
+---------------------------------------------------------------------------------+
                                      | (Tenant Context Passed)
                                      v
+---------------------------------------------------------------------------------+
|                               Domain Services                                   |
|  - ImageService: Manages image lifecycle, idempotent enqueue                    |
|  - PostService: Handles blog creation and embedding triggering                  |
|  - MatchingService: Vector ranking and cosine distance within tenant boundaries |
|  - MismatchGuard: Deterministic multi-gate safety verification                   |
|  - ReviewService: Feedback recording and editorial audits                       |
|  - BudgetGuardService: Tracks and enforces per-tenant spending limits           |
+---------------------------------------------------------------------------------+
         |                                 |                             |
         v                                 v                             v
+------------------+             +-------------------+         +------------------+
|   Worker Layer   |             |   Provider Layer  |         | Repository Layer |
| - JobQueueWorker |             | - IVisionProvider |         | (Enforces WHERE  |
| - Idempotent Key |             | - IEmbedding      |         |  tenant_id = ?)  |
| - Task Dispatch  |             | - GeminiProvider  |         | - ImageRepo      |
| - Backoff/Retry  |             | - MockProvider    |         | - PostRepo       |
| - Budget Check   |             +-------------------+         | - VectorRepo     |
+------------------+                       |                   | - JobRepo        |
         |                                 |                   | - ReviewRepo     |
         |                                 |                   | - AICallsRepo    |
         |                                 |                   +------------------+
         +---------------------------------+-----------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------+
|                           PostgreSQL Data Layer                                 |
|  - tenants (root boundary)                                                      |
|  - images, image_metadata, image_vectors, tags, image_tags                      |
|  - posts, post_vectors, suggestions, reviews, jobs, job_failures, ai_calls       |
|  - budget_events                                                                |
+---------------------------------------------------------------------------------+
```

---

## 3. Pluggable AI Provider Interfaces

To ensure zero-cost development, prevent vendor lock-in, and enable unit testing with mock data without spending API credits or making external network requests, AI calls are isolated behind TypeScript interfaces:

### Vision Provider Interface (`src/providers/IVisionProvider.ts`)

```typescript
export interface VisionAnalysisResult {
  subject: string;
  category: string;
  attributes: string[];
  caption: string;
  confidence: number;
  rawResponse: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface IVisionProvider {
  analyzeImage(imageUrlOrBuffer: string | Buffer): Promise<VisionAnalysisResult>;
}
```

### Embedding Provider Interface (`src/providers/IEmbeddingProvider.ts`)

```typescript
export interface EmbeddingResult {
  modelName: string;
  dimensions: number;
  vector: number[];
  inputTokens: number;
  latencyMs: number;
}

export interface IEmbeddingProvider {
  generateEmbedding(text: string): Promise<EmbeddingResult>;
}
```

---

## 4. Idempotent Background Job Architecture

Background execution is backed by PostgreSQL table transactions with unique operation keys to prevent duplicate execution side effects during retries.

```
+------------+       Worker Polls (SKIP LOCKED)       +----------------+
|   Queued   | -------------------------------------> |   Processing   |
+------------+                                        +----------------+
      ^                                                  |            |
      |                                      Success     |            | Error / Thrown
      | (Retry delay: 5s * 2^attempts)                   v            v
      +------------------------------------------ [ Reschedule ]  [ Fail Check ]
                                                                      |
                                                          attempts >= max_attempts?
                                                          /                       \
                                                       [YES]                     [NO]
                                                         |                         |
                                                         v                         v
                                                 +---------------+         +---------------+
                                                 | Marked FAILED |         | Backoff Delay |
                                                 +---------------+         +---------------+
```

### Idempotency Safeguards:

1. **Deduplication Key**: `jobs` has a unique constraint `UNIQUE (tenant_id, idempotency_key)`.
2. **Metadata & Vectors**: Inserted via `ON CONFLICT (tenant_id, image_id) DO UPDATE`.
3. **AI Cost Invocations**: Tracked with `operation_id = sha256(tenant_id + ":" + job_id + ":" + attempt)`. Re-executing an existing step updates or ignores duplicate billing logs.
4. **Suggestions**: Upserted via `ON CONFLICT (tenant_id, post_id, image_id) DO UPDATE`.

---

## 5. AI Cost Budget Guard Architecture

```
                 [ Task Ready for Execution ]
                              |
                              v
                 +--------------------------+
                 | Compute Tenant Total     |
                 | Spend from `ai_calls`    |
                 +--------------------------+
                              |
                   Total Spend >= Max Budget?
                     /                  \
                  [YES]                [NO]
                    |                    |
                    v                    v
      +------------------------+   +------------------------+
      | Defer / Reject Job     |   | Invoke Provider API    |
      | Status: budget_rejected|   | (Record Token Usage)   |
      | Log to `budget_events` |   +------------------------+
      +------------------------+
```

---

## 6. Mismatch Guard Decision Engine

The Mismatch Guard is an independent domain service that receives candidate images ranked by vector similarity and determines eligibility:

```
Input: Blog Post Vector & Image Candidates (Sim >= Initial Threshold 0.720)
                     |
        For each candidate in rank order:
                     |
                     +---> Gate 1: Check Image Confidence (>= 0.70) & Quarantine
                     |       Fail: RejectionReason = "LOW_CONFIDENCE" / "QUARANTINED"
                     |
                     +---> Gate 2: Check Category Compatibility
                     |       Fail: RejectionReason = "CATEGORY_MISMATCH"
                     |
                     +---> Gate 3: Check Subject Incompatibility Rules
                     |       Fail: RejectionReason = "SUBJECT_CONFLICT" ("Animal category mismatch: expected fox, detected wolf")
                     |
                     +---> Gate 4: Cosine Similarity Calculation (defensive against zero/NaN/mismatched dims)
                     |
                     +---> Gate 5: Check Similarity Floor (Configurable 0.720 provisional baseline)
                             Fail: RejectionReason = "SIMILARITY_BELOW_THRESHOLD"
                     |
  Did any candidate pass all gates?
         /                     \
       [YES]                   [NO]
         |                       |
Return Top Passed Candidate   Return status="no_confident_match", bestMatch=null
with Guard Approval Metadata   with Audit Rejection Logs across all candidates

---

## 7. Phase 5 Matching Engine & Review Architecture

### Matching Engine Pipeline (`src/services/matching/MatchingEngineService.ts`)
The matching engine implements a deterministic multi-stage evaluation pipeline:
1. **Candidate Retrieval**: Fetches all completed, vector-indexed images for the authenticated tenant.
2. **Confidence / Quarantine Gate**: Rejects any candidate where `isQuarantined` is true or `confidence < confidenceFloor` (default 0.70). Reason code: `LOW_CONFIDENCE` or `QUARANTINED`.
3. **Category Compatibility Gate**: Rejects candidates whose category does not match the post's synthesized domain category. Reason code: `CATEGORY_MISMATCH`.
4. **Subject Conflict Gate**: Applies taxonomy rules (`DEFAULT_SUBJECT_CONFLICT_RULES` in `src/services/matching/conflictRules.ts`) to detect incompatible subjects (e.g. Red Fox vs Gray Wolf, Brown Bear vs Otter). Reason code: `SUBJECT_CONFLICT`.
5. **Defensive Cosine Similarity**: Computes $(A \cdot B) / (||A|| \times ||B||)$ in `src/services/matching/cosineSimilarity.ts`. Defensively returns 0 for zero vectors, mismatched vector dimensions, or non-finite values (NaN / Infinity).
6. **Similarity Threshold Gate**: Compares computed similarity against the configurable threshold (default `0.720`). Candidates below threshold receive reason code `SIMILARITY_BELOW_THRESHOLD`.
7. **Ranking & Idempotent Suggestion Persistence**: Eligible candidates are sorted descending by similarity score. The best match is selected. Suggestions are persisted idempotently by removing existing suggestions for the post (`deleteByPostId`) and storing candidate audits.
8. **Safe Fallback**: If no candidate satisfies all gates, the engine returns `status: "no_confident_match"`, `bestMatch: null`, and full candidate audit entries.

### Editorial Review Workflow (`src/services/ReviewService.ts`)
- Allows human editors to submit approvals, rejections, and notes on engine suggestions via `POST /reviews`.
- Validates tenant ownership of the referenced suggestion before writing, preventing cross-tenant review modifications.
- Allows filtering and querying reviews via `GET /reviews`.

### Evaluation Benchmark Framework (`scripts/benchmark.ts`)
- Benchmark runner evaluates 12 ground-truth labeled posts across all 4 categories against the 48-image corpus.
- Automatically calculates Top-1 precision, audit candidate rejection reasons, and validates against the $\ge 80\%$ target.
```
