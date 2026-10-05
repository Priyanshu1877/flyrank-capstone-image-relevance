import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool, closePool } from '../src/config/database.js';
import { TenantAuthenticator } from '../src/utils/auth.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { ImageIngestionTransaction } from '../src/services/ImageIngestionTransaction.js';
import { DatasetManifestSchema, ManifestItem, DatasetManifest } from './validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '..');

export interface IngestDatasetOptions {
  apiKey?: string;
  claimedTenantId?: string;
  manifestPath?: string;
  imagesBaseDir?: string;
  dryRun?: boolean;
  poolOverride?: pg.Pool;
}

export interface IngestionResult {
  success: boolean;
  tenantId: string;
  tenantName: string;
  totalProcessed: number;
  newlyIngested: number;
  alreadyExisted: number;
  jobsQueued: number;
  failed: number;
  errors: string[];
}

export function validateImageFile(
  item: ManifestItem,
  imagesBaseDir: string
): { isValid: boolean; error?: string } {
  const filePath = path.join(imagesBaseDir, item.filename);

  if (!fs.existsSync(filePath)) {
    return { isValid: false, error: `File not found on disk: ${item.filename}` };
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 1000) {
    return {
      isValid: false,
      error: `File corrupted or under minimum size (< 1KB): ${item.filename}`
    };
  }

  if (item.format === 'image/jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return { isValid: false, error: `Invalid JPEG magic header bytes: ${item.filename}` };
    }
  }

  const computedHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (computedHash !== item.checksumSha256) {
    return {
      isValid: false,
      error: `Checksum mismatch for ${item.filename}: expected ${item.checksumSha256}, got ${computedHash}`
    };
  }

  return { isValid: true };
}

export async function ingestDataset(options: IngestDatasetOptions = {}): Promise<IngestionResult> {
  const manifestPath =
    options.manifestPath ?? path.join(defaultRootDir, 'data', 'dataset.manifest.json');
  const imagesBaseDir = options.imagesBaseDir ?? path.join(defaultRootDir, 'data', 'images');
  const apiKey =
    options.apiKey ?? process.env.FLYRANK_API_KEY ?? process.env.API_KEY ?? 'default-dev-api-key';
  const claimedTenantId = options.claimedTenantId;
  const dryRun = options.dryRun ?? false;
  const pool = options.poolOverride ?? getPool();

  const tenantRepo = new TenantRepository();
  const authenticator = new TenantAuthenticator(tenantRepo);
  const imageRepo = new ImageRepository();
  const jobRepo = new JobRepository();
  const ingestionTx = new ImageIngestionTransaction(imageRepo, jobRepo);

  // Step 1: Strict tenant authentication
  const tenantContext = await authenticator.authenticate(apiKey, claimedTenantId);
  const tenantId = tenantContext.tenantId;
  const tenantName = tenantContext.tenant.name;

  // Step 2: Read and validate dataset manifest
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at: ${manifestPath}`);
  }

  const rawContent = fs.readFileSync(manifestPath, 'utf-8');
  const parseResult = DatasetManifestSchema.safeParse(JSON.parse(rawContent));
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid dataset manifest schema:\n  ${errorMessages.join('\n  ')}`);
  }

  const manifest: DatasetManifest = parseResult.data;

  const result: IngestionResult = {
    success: true,
    tenantId,
    tenantName,
    totalProcessed: 0,
    newlyIngested: 0,
    alreadyExisted: 0,
    jobsQueued: 0,
    failed: 0,
    errors: []
  };

  // Step 3: Validate and ingest images
  for (const item of manifest.images) {
    result.totalProcessed++;

    // Validate file integrity
    const validation = validateImageFile(item, imagesBaseDir);
    if (!validation.isValid) {
      result.failed++;
      result.errors.push(`${item.id} (${item.filename}): ${validation.error}`);
      result.success = false;
      continue;
    }

    if (dryRun) {
      result.newlyIngested++;
      result.jobsQueued++;
      continue;
    }

    try {
      // Check if image already exists before ingestion to track idempotency state
      const existingImage = await imageRepo.findByUrl(tenantId, item.sourceUrl, pool);

      // Execute atomic transaction: register image and enqueue processing job
      const txResult = await ingestionTx.execute(tenantId, item.sourceUrl, item.filename, pool);

      if (existingImage) {
        result.alreadyExisted++;
      } else {
        result.newlyIngested++;
      }

      if (txResult.job) {
        result.jobsQueued++;
      }
    } catch (err: unknown) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to ingest ${item.id} (${item.filename}): ${message}`);
      result.success = false;
    }
  }

  return result;
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let apiKey: string | undefined;
  let claimedTenantId: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key' && i + 1 < args.length) {
      apiKey = args[++i];
    } else if (args[i] === '--tenant-id' && i + 1 < args.length) {
      claimedTenantId = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  console.log('====================================================');
  console.log('       FLYRANK IMAGE INGESTION PIPELINE             ');
  console.log('====================================================');
  if (dryRun) {
    console.log('[MODE] DRY-RUN (Validation only, no database writes)');
  }

  try {
    const outcome = await ingestDataset({
      apiKey,
      claimedTenantId,
      dryRun
    });

    console.log(`Tenant:           ${outcome.tenantName} (${outcome.tenantId})`);
    console.log(`Total Ingested:   ${outcome.totalProcessed}`);
    console.log(`Newly Registered: ${outcome.newlyIngested}`);
    console.log(`Already Existing: ${outcome.alreadyExisted}`);
    console.log(`Jobs Queued:      ${outcome.jobsQueued}`);
    console.log(`Failures:         ${outcome.failed}`);

    if (outcome.errors.length > 0) {
      console.error('\nIngestion Errors:');
      outcome.errors.forEach((err) => console.error(`  - ${err}`));
    }

    console.log('----------------------------------------------------');
    if (outcome.success) {
      console.log('✓ INGESTION PIPELINE COMPLETED SUCCESSFULLY.');
      console.log('====================================================');
      await closePool();
      process.exit(0);
    } else {
      console.error('✗ INGESTION PIPELINE ENCOUNTERED FAILURES.');
      console.log('====================================================');
      await closePool();
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[FATAL] Ingestion aborted: ${message}`);
    console.log('====================================================');
    await closePool();
    process.exit(1);
  }
}
