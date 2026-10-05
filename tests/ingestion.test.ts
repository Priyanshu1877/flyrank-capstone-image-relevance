import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePool, query } from '../src/config/database.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { ImageIngestionTransaction } from '../src/services/ImageIngestionTransaction.js';
import { TenantAuthenticator } from '../src/utils/auth.js';
import { Tenant } from '../src/models/types.js';
import { DatasetManifestSchema, ManifestItemSchema, validateDataset } from '../data/validate.js';
import { ingestDataset, validateImageFile } from '../data/ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Dataset Acquisition & Ingestion Pipeline', () => {
  const tenantRepo = new TenantRepository();
  const imageRepo = new ImageRepository();
  const jobRepo = new JobRepository();
  const auth = new TenantAuthenticator(tenantRepo);
  const ingestionTx = new ImageIngestionTransaction(imageRepo, jobRepo);

  let testTenantA: Tenant;
  let testTenantB: Tenant;
  const rawKeyA = `ingest-tenant-a-${Date.now()}`;
  const rawKeyB = `ingest-tenant-b-${Date.now()}`;

  beforeAll(async () => {
    testTenantA = await tenantRepo.create({
      name: 'Ingestion Test Tenant Alpha',
      apiKeyHash: auth.hashApiKey(rawKeyA),
      maxBudgetUsd: 10.0
    });

    testTenantB = await tenantRepo.create({
      name: 'Ingestion Test Tenant Beta',
      apiKeyHash: auth.hashApiKey(rawKeyB),
      maxBudgetUsd: 10.0
    });
  });

  afterAll(async () => {
    // Clean up test images and jobs
    await query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [testTenantA.id, testTenantB.id]);
    await query('DELETE FROM images WHERE tenant_id IN ($1, $2)', [testTenantA.id, testTenantB.id]);
    await query('DELETE FROM tenants WHERE id IN ($1, $2)', [testTenantA.id, testTenantB.id]);
    await closePool();
  });

  it('1. Manifest Validation: verifies official dataset manifest passes strict Zod schema', () => {
    const manifestPath = path.join(rootDir, 'data', 'dataset.manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const parseResult = DatasetManifestSchema.safeParse(manifestContent);

    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.totalImages).toBe(48);
      expect(parseResult.data.images.length).toBe(48);
    }
  });

  it('2. Manifest Validation: rejects malformed manifest items', () => {
    const invalidItem = {
      id: 'img_test_bad',
      category: 'invalid_category', // Invalid category
      subject: 'x', // Too short
      filename: 'bad.jpg',
      fileSizeBytes: -50, // Must be positive
      format: 'image/gif', // Unsupported format
      checksumSha256: 'invalid_hex', // Not 64 char hex
      sourceUrl: 'not_a_url',
      provider: 'X',
      author: 'A',
      license: 'L',
      attribution: 'Attribution',
      acquiredAt: 'invalid-date'
    };

    const result = ManifestItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
  });

  it('3. Dataset File Discovery: verifies all 48 images exist on disk with valid headers', () => {
    const report = validateDataset();
    expect(report.isValid).toBe(true);
    expect(report.missingFiles).toHaveLength(0);
    expect(report.invalidFormats).toHaveLength(0);
    expect(report.mismatchedChecksums).toHaveLength(0);
    expect(report.duplicateChecksums).toHaveLength(0);
  });

  it('4. Dataset Count & Category Verification: confirms category quota distribution', () => {
    const report = validateDataset();
    expect(report.totalImages).toBe(48);
    expect(report.categoryDistribution.wildlife).toBe(12);
    expect(report.categoryDistribution.culinary).toBe(12);
    expect(report.categoryDistribution.technology).toBe(12);
    expect(report.categoryDistribution.architecture).toBe(12);
  });

  it('5. Invalid/Missing Image Rejection: rejects non-existent or corrupted files', () => {
    const dummyItem = {
      id: 'img_dummy_nonexistent',
      category: 'wildlife' as const,
      subject: 'phantom fox',
      filename: 'wildlife/nonexistent_phantom_file.jpg',
      fileSizeBytes: 12345,
      format: 'image/jpeg' as const,
      checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sourceUrl: 'https://images.unsplash.com/photo-nonexistent',
      provider: 'Unsplash',
      author: 'Ghost',
      license: 'Unsplash License',
      attribution: 'Ghost via Unsplash',
      acquiredAt: '2026-10-05'
    };

    const validation = validateImageFile(dummyItem, path.join(rootDir, 'data', 'images'));
    expect(validation.isValid).toBe(false);
    expect(validation.error).toContain('File not found on disk');
  });

  it('6. Valid Image Ingestion: persists image record with status pending', async () => {
    const testUrl = 'https://images.unsplash.com/photo-test-valid-01?w=640';
    const txResult = await ingestionTx.execute(
      testTenantA.id,
      testUrl,
      'wildlife/img_wildlife_01.jpg'
    );

    expect(txResult.image).toBeDefined();
    expect(txResult.image.tenantId).toBe(testTenantA.id);
    expect(txResult.image.url).toBe(testUrl);
    expect(txResult.image.originalFilename).toBe('wildlife/img_wildlife_01.jpg');
    expect(txResult.image.status).toBe('pending');
    expect(txResult.image.flagged).toBe(false);

    // Verify stored row in database
    const saved = await imageRepo.findById(testTenantA.id, txResult.image.id);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe('pending');
  });

  it('7. Job Creation & Atomicity: enqueues PROCESS_IMAGE job linked to image ID', async () => {
    const testUrl = 'https://images.unsplash.com/photo-test-valid-02?w=640';
    const txResult = await ingestionTx.execute(
      testTenantA.id,
      testUrl,
      'culinary/img_culinary_01.jpg'
    );

    expect(txResult.job).toBeDefined();
    expect(txResult.job.tenantId).toBe(testTenantA.id);
    expect(txResult.job.type).toBe('PROCESS_IMAGE');
    expect(txResult.job.status).toBe('queued');
    expect(txResult.job.maxAttempts).toBe(3);
    expect(txResult.job.payload.imageId).toBe(txResult.image.id);
    expect(txResult.job.payload.url).toBe(testUrl);

    // Verify job in database
    const savedJob = await jobRepo.findById(testTenantA.id, txResult.job.id);
    expect(savedJob).not.toBeNull();
    expect(savedJob?.status).toBe('queued');
  });

  it('8. Duplicate Ingestion Idempotency: re-ingesting same URL creates no duplicate image or job', async () => {
    const testUrl = 'https://images.unsplash.com/photo-test-idempotent?w=640';

    // First ingestion
    const run1 = await ingestionTx.execute(testTenantA.id, testUrl, 'tech.jpg');
    // Second ingestion
    const run2 = await ingestionTx.execute(testTenantA.id, testUrl, 'tech-renamed.jpg');

    expect(run2.image.id).toBe(run1.image.id);
    expect(run2.job.id).toBe(run1.job.id);

    // Verify exactly 1 image exists for this URL in tenant A
    const listRes = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM images WHERE tenant_id = $1 AND url = $2',
      [testTenantA.id, testUrl]
    );
    expect(parseInt(listRes.rows[0]?.count ?? '0', 10)).toBe(1);

    // Verify exactly 1 job exists for this idempotency key in tenant A
    const jobListRes = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM jobs WHERE tenant_id = $1 AND idempotency_key = $2',
      [testTenantA.id, run1.job.idempotencyKey]
    );
    expect(parseInt(jobListRes.rows[0]?.count ?? '0', 10)).toBe(1);
  });

  it('9. Tenant Isolation: guarantees cross-tenant separation of ingested records', async () => {
    const sharedUrl = 'https://images.unsplash.com/photo-shared-across-tenants?w=640';

    const resultA = await ingestionTx.execute(testTenantA.id, sharedUrl, 'img-a.jpg');
    const resultB = await ingestionTx.execute(testTenantB.id, sharedUrl, 'img-b.jpg');

    // Both tenants have distinct image IDs despite same URL
    expect(resultA.image.id).not.toBe(resultB.image.id);
    expect(resultA.job.id).not.toBe(resultB.job.id);

    // Tenant A cannot read Tenant B's image
    const crossRead = await imageRepo.findById(testTenantA.id, resultB.image.id);
    expect(crossRead).toBeNull();

    // Tenant B cannot read Tenant A's job
    const crossJobRead = await jobRepo.findById(testTenantB.id, resultA.job.id);
    expect(crossJobRead).toBeNull();
  });

  it('10. Transaction Rollback: rolls back image creation if job enqueueing fails', async () => {
    const invalidUrl = 'https://images.unsplash.com/photo-will-rollback?w=640';

    // Mock jobRepo to force failure inside transaction
    const failingJobRepo = new JobRepository();
    failingJobRepo.enqueue = async () => {
      throw new Error('Simulated database deadlock or disk failure during job enqueue');
    };

    const failingTx = new ImageIngestionTransaction(imageRepo, failingJobRepo);

    await expect(failingTx.execute(testTenantA.id, invalidUrl, 'will-fail.jpg')).rejects.toThrow(
      'Simulated database deadlock'
    );

    // Confirm image was rolled back and does not exist in DB
    const orphanedImage = await imageRepo.findByUrl(testTenantA.id, invalidUrl);
    expect(orphanedImage).toBeNull();
  });

  it('11. Full Dataset Ingestion & Re-run Idempotency', async () => {
    // Run full ingestion on Tenant B
    const outcome1 = await ingestDataset({
      apiKey: rawKeyB,
      manifestPath: path.join(rootDir, 'data', 'dataset.manifest.json'),
      imagesBaseDir: path.join(rootDir, 'data', 'images')
    });

    expect(outcome1.success).toBe(true);
    expect(outcome1.totalProcessed).toBe(48);
    expect(outcome1.newlyIngested).toBe(48);
    expect(outcome1.alreadyExisted).toBe(0);
    expect(outcome1.jobsQueued).toBe(48);
    expect(outcome1.failed).toBe(0);

    // Check database counts for Tenant B
    const imgCountBefore = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM images WHERE tenant_id = $1',
      [testTenantB.id]
    );
    const jobCountBefore = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM jobs WHERE tenant_id = $1',
      [testTenantB.id]
    );
    // 48 from dataset + 1 from previous tenant isolation test
    expect(parseInt(imgCountBefore.rows[0]?.count ?? '0', 10)).toBe(49);
    expect(parseInt(jobCountBefore.rows[0]?.count ?? '0', 10)).toBe(49);

    // Re-run full ingestion a second time
    const outcome2 = await ingestDataset({
      apiKey: rawKeyB,
      manifestPath: path.join(rootDir, 'data', 'dataset.manifest.json'),
      imagesBaseDir: path.join(rootDir, 'data', 'images')
    });

    expect(outcome2.success).toBe(true);
    expect(outcome2.totalProcessed).toBe(48);
    expect(outcome2.newlyIngested).toBe(0);
    expect(outcome2.alreadyExisted).toBe(48);
    expect(outcome2.jobsQueued).toBe(48); // Re-verified/updated idempotently
    expect(outcome2.failed).toBe(0);

    // Verify row counts in database did NOT increase
    const imgCountAfter = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM images WHERE tenant_id = $1',
      [testTenantB.id]
    );
    const jobCountAfter = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM jobs WHERE tenant_id = $1',
      [testTenantB.id]
    );

    expect(imgCountAfter.rows[0]?.count).toBe(imgCountBefore.rows[0]?.count);
    expect(jobCountAfter.rows[0]?.count).toBe(jobCountBefore.rows[0]?.count);
  });
});
