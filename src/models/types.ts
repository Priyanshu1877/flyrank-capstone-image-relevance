// Domain Models and Types for FlyRank AI Image Understanding & Content Matching Engine

export interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;
  maxBudgetUsd: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ImageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Image {
  id: string;
  tenantId: string;
  url: string;
  originalFilename: string | null;
  status: ImageStatus;
  flagged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImageMetadata {
  id: string;
  tenantId: string;
  imageId: string;
  subject: string;
  category: string;
  caption: string;
  attributes: string[];
  confidence: number;
  rawResponse: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ImageVector {
  id: string;
  tenantId: string;
  imageId: string;
  modelName: string;
  dimensions: number;
  embedding: number[];
  createdAt: Date;
}

export type PostStatus = 'draft' | 'published' | 'archived';

export interface Post {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  body: string;
  primaryCategory: string | null;
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostVector {
  id: string;
  tenantId: string;
  postId: string;
  modelName: string;
  dimensions: number;
  embedding: number[];
  createdAt: Date;
}

export interface Tag {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface ImageTag {
  tenantId: string;
  imageId: string;
  tagId: string;
  createdAt: Date;
}

export type SuggestionStatus = 'suggested' | 'no_confident_match';

export interface Suggestion {
  id: string;
  tenantId: string;
  postId: string;
  imageId: string | null;
  similarityScore: number;
  rank: number;
  guardPassed: boolean;
  rejectionReason: string | null;
  guardDetails: Record<string, unknown> | null;
  status: SuggestionStatus;
  createdAt: Date;
}

export type ReviewDecision = 'approved' | 'rejected' | 'modified';

export interface Review {
  id: string;
  tenantId: string;
  suggestionId: string;
  decision: ReviewDecision;
  notes: string | null;
  reviewerId: string;
  createdAt: Date;
}

export type JobType = 'PROCESS_IMAGE' | 'GENERATE_POST_EMBEDDING' | 'REINDEX_VECTORS';
export type JobStatus =
  'queued' | 'processing' | 'completed' | 'failed' | 'deferred' | 'budget_rejected';

export interface Job {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  lockedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobFailure {
  id: string;
  tenantId: string;
  jobId: string;
  attempt: number;
  errorMessage: string;
  stackTrace: string | null;
  failedAt: Date;
}

export type AICallTaskType = 'vision_metadata' | 'text_embedding' | 'similarity_eval';
export type AICallStatus = 'success' | 'failure' | 'budget_rejected' | 'rate_limited';

export interface AICall {
  id: string;
  tenantId: string;
  callIdentity: string;
  operationId: string;
  attempt: number;
  provider: string;
  model: string;
  taskType: AICallTaskType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: AICallStatus;
  errorCode: string | null;
  createdAt: Date;
}

export interface BudgetEvent {
  id: string;
  tenantId: string;
  attemptedAction: string;
  currentSpendUsd: number;
  maxBudgetUsd: number;
  message: string;
  occurredAt: Date;
}
