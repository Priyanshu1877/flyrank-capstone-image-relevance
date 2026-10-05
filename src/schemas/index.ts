import { z } from 'zod';

// Vision Metadata Schema (Approved in Phase 1 Design)
export const VisionMetadataSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(2, 'Subject must be at least 2 characters')
    .max(100, 'Subject must be at most 100 characters')
    .toLowerCase(),
  category: z
    .string()
    .trim()
    .min(2, 'Category must be at least 2 characters')
    .max(50, 'Category must be at most 50 characters')
    .toLowerCase(),
  attributes: z
    .array(z.string().trim().min(2).max(40).toLowerCase())
    .min(1, 'At least one descriptive attribute is required')
    .max(15, 'Maximum 15 attributes allowed'),
  caption: z
    .string()
    .trim()
    .min(10, 'Caption must be descriptive (at least 10 chars)')
    .max(500, 'Caption cannot exceed 500 chars'),
  confidence: z
    .number()
    .min(0.0, 'Confidence cannot be less than 0')
    .max(1.0, 'Confidence cannot exceed 1.0')
});

export type VisionMetadataInput = z.infer<typeof VisionMetadataSchema>;

// Tenant Schemas
export const CreateTenantSchema = z.object({
  name: z.string().trim().min(2).max(128),
  apiKeyHash: z.string().min(32).max(128),
  maxBudgetUsd: z.number().positive().default(5.0)
});

// Image Schemas
export const CreateImageSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  originalFilename: z.string().max(255).optional().nullable()
});

export const UpdateImageStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  flagged: z.boolean().optional()
});

// Post Schemas
export const CreatePostSchema = z.object({
  title: z.string().trim().min(3).max(256),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(256)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  body: z.string().trim().min(10),
  primaryCategory: z.string().trim().max(64).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).default('draft')
});

// Vector Schemas
export const VectorInputSchema = z.object({
  modelName: z.string().min(2).max(64),
  dimensions: z.number().int().positive(),
  embedding: z.array(z.number()).min(1)
});

// Suggestion Schemas
export const CreateSuggestionSchema = z.object({
  postId: z.string().uuid(),
  imageId: z.string().uuid().nullable(),
  similarityScore: z.number().min(0.0).max(1.0),
  rank: z.number().int().positive(),
  guardPassed: z.boolean(),
  rejectionReason: z.string().nullable().optional(),
  guardDetails: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(['suggested', 'no_confident_match']).default('suggested')
});

// Review Schemas
export const CreateReviewSchema = z.object({
  suggestionId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'modified']),
  notes: z.string().max(1000).nullable().optional(),
  reviewerId: z.string().min(2).max(64).default('editorial_team')
});

// Job Schemas
export const CreateJobSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  type: z.enum(['PROCESS_IMAGE', 'GENERATE_POST_EMBEDDING', 'REINDEX_VECTORS']),
  payload: z.record(z.string(), z.unknown()),
  maxAttempts: z.number().int().positive().default(3),
  scheduledAt: z.date().optional()
});

export const RecordJobFailureSchema = z.object({
  jobId: z.string().uuid(),
  attempt: z.number().int().positive(),
  errorMessage: z.string().min(1),
  stackTrace: z.string().nullable().optional()
});

// AI Telemetry Schemas
export const RecordAICallSchema = z.object({
  callIdentity: z.string().min(8).max(128),
  operationId: z.string().min(8).max(128),
  attempt: z.number().int().positive().default(1),
  provider: z.string().min(2).max(64),
  model: z.string().min(2).max(64),
  taskType: z.enum(['vision_metadata', 'text_embedding', 'similarity_eval']),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0.0),
  latencyMs: z.number().int().nonnegative(),
  status: z.enum(['success', 'failure', 'budget_rejected', 'rate_limited']),
  errorCode: z.string().max(64).nullable().optional()
});

// Budget Event Schemas
export const RecordBudgetEventSchema = z.object({
  attemptedAction: z.string().min(2).max(64),
  currentSpendUsd: z.number().nonnegative(),
  maxBudgetUsd: z.number().nonnegative(),
  message: z.string().min(1)
});
