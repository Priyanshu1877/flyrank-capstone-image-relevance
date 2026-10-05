import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  GEMINI_API_KEY: z.string().default('mock-key'),
  GEMINI_VISION_MODEL: z.string().default('gemini-1.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  AI_MAX_BUDGET_USD: z.coerce.number().positive().default(5.0),
  INITIAL_MATCH_SIMILARITY_THRESHOLD: z.coerce.number().min(0.0).max(1.0).default(0.72),
  MIN_VISION_CONFIDENCE: z.coerce.number().min(0.0).max(1.0).default(0.7),
  QUARANTINE_VISION_CONFIDENCE: z.coerce.number().min(0.0).max(1.0).default(0.4),
  JOB_POLL_INTERVAL_MS: z.coerce.number().positive().default(3000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_BASE_BACKOFF_MS: z.coerce.number().positive().default(5000),
  DEFAULT_TENANT_ID: z.string().uuid().default('e1f1c7d2-3498-4c1d-84fb-39074742a001'),
  DEFAULT_TENANT_NAME: z.string().default('Default Editorial Tenant')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error('[Config] Invalid environment configuration:\n' + issues);
  throw new Error('Environment configuration validation failed');
}

export const env = parsed.data;

/**
 * Returns a sanitized view of configuration suitable for logging (masks secrets).
 */
export function getSanitizedConfig(): Record<string, unknown> {
  return {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    DATABASE_URL: maskSecret(env.DATABASE_URL),
    TEST_DATABASE_URL: env.TEST_DATABASE_URL ? maskSecret(env.TEST_DATABASE_URL) : undefined,
    AI_PROVIDER: env.AI_PROVIDER,
    GEMINI_API_KEY: maskSecret(env.GEMINI_API_KEY),
    GEMINI_VISION_MODEL: env.GEMINI_VISION_MODEL,
    GEMINI_EMBEDDING_MODEL: env.GEMINI_EMBEDDING_MODEL,
    AI_MAX_BUDGET_USD: env.AI_MAX_BUDGET_USD,
    INITIAL_MATCH_SIMILARITY_THRESHOLD: env.INITIAL_MATCH_SIMILARITY_THRESHOLD,
    MIN_VISION_CONFIDENCE: env.MIN_VISION_CONFIDENCE,
    QUARANTINE_VISION_CONFIDENCE: env.QUARANTINE_VISION_CONFIDENCE,
    DEFAULT_TENANT_ID: env.DEFAULT_TENANT_ID
  };
}

function maskSecret(val: string): string {
  if (!val || val.length <= 8) return '********';
  return val.slice(0, 4) + '...' + val.slice(-4);
}
