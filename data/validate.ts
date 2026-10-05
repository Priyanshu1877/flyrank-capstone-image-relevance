import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const ManifestItemSchema = z.object({
  id: z.string().min(3),
  category: z.enum(['wildlife', 'culinary', 'technology', 'architecture']),
  subject: z.string().min(2),
  filename: z.string().min(4),
  fileSizeBytes: z.number().int().positive(),
  format: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  checksumSha256: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  sourceUrl: z.string().url(),
  provider: z.string().min(2),
  author: z.string().min(2),
  license: z.string().min(2),
  attribution: z.string().min(2),
  acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const DatasetManifestSchema = z.object({
  version: z.string(),
  status: z.string(),
  totalImages: z.number().int().positive(),
  categories: z.object({
    wildlife: z.number().int().min(10),
    culinary: z.number().int().min(10),
    technology: z.number().int().min(10),
    architecture: z.number().int().min(10)
  }),
  licensePolicy: z.string().min(5),
  images: z.array(ManifestItemSchema).min(40)
});

export type ManifestItem = z.infer<typeof ManifestItemSchema>;
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;

export interface ValidationReport {
  isValid: boolean;
  totalImages: number;
  categoryDistribution: Record<string, number>;
  missingFiles: string[];
  mismatchedChecksums: string[];
  duplicateChecksums: string[];
  invalidFormats: string[];
  incompleteLicensing: string[];
  errors: string[];
}

export function validateDataset(): ValidationReport {
  const report: ValidationReport = {
    isValid: true,
    totalImages: 0,
    categoryDistribution: {
      wildlife: 0,
      culinary: 0,
      technology: 0,
      architecture: 0
    },
    missingFiles: [],
    mismatchedChecksums: [],
    duplicateChecksums: [],
    invalidFormats: [],
    incompleteLicensing: [],
    errors: []
  };

  const manifestPath = path.join(rootDir, 'data', 'dataset.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    report.isValid = false;
    report.errors.push('Manifest file data/dataset.manifest.json not found');
    return report;
  }

  let rawManifest: unknown;
  try {
    const rawContent = fs.readFileSync(manifestPath, 'utf-8');
    rawManifest = JSON.parse(rawContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    report.isValid = false;
    report.errors.push(`Manifest JSON parse error: ${msg}`);
    return report;
  }

  const parseResult = DatasetManifestSchema.safeParse(rawManifest);
  if (!parseResult.success) {
    report.isValid = false;
    for (const issue of parseResult.error.issues) {
      report.errors.push(`Manifest Schema Error: ${issue.path.join('.')}: ${issue.message}`);
    }
    return report;
  }

  const manifest = parseResult.data;
  report.totalImages = manifest.images.length;

  const seenIds = new Set<string>();
  const seenChecksums = new Map<string, string>(); // checksum -> id

  for (const item of manifest.images) {
    // Check ID uniqueness
    if (seenIds.has(item.id)) {
      report.errors.push(`Duplicate image ID in manifest: ${item.id}`);
      report.isValid = false;
    }
    seenIds.add(item.id);

    // Track category distribution
    report.categoryDistribution[item.category] =
      (report.categoryDistribution[item.category] ?? 0) + 1;

    // Check licensing completeness
    if (!item.license || !item.attribution || !item.sourceUrl) {
      report.incompleteLicensing.push(item.id);
      report.isValid = false;
    }

    // Check duplicate checksums across different items
    if (seenChecksums.has(item.checksumSha256)) {
      report.duplicateChecksums.push(
        `${item.id} duplicates ${seenChecksums.get(item.checksumSha256)} (${item.checksumSha256})`
      );
      report.isValid = false;
    } else {
      seenChecksums.set(item.checksumSha256, item.id);
    }

    // Check file on disk
    const filePath = path.join(rootDir, 'data', 'images', item.filename);
    if (!fs.existsSync(filePath)) {
      report.missingFiles.push(item.filename);
      report.isValid = false;
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 1000) {
      report.errors.push(`File too small or corrupted (< 1KB): ${item.filename}`);
      report.isValid = false;
      continue;
    }

    // Check JPEG magic bytes (FF D8 FF)
    if (item.format === 'image/jpeg') {
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        report.invalidFormats.push(`${item.filename}: Missing valid JPEG magic header bytes`);
        report.isValid = false;
      }
    }

    // Verify SHA-256 checksum
    const computedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (computedHash !== item.checksumSha256) {
      report.mismatchedChecksums.push(
        `${item.filename} (Manifest: ${item.checksumSha256}, Actual: ${computedHash})`
      );
      report.isValid = false;
    }
  }

  // Minimum distribution requirements: at least 10 per category
  for (const [cat, count] of Object.entries(report.categoryDistribution)) {
    if (count < 10) {
      report.errors.push(`Category '${cat}' has only ${count} images (minimum 10 required)`);
      report.isValid = false;
    }
  }

  return report;
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('====================================================');
  console.log('       FLYRANK DATASET QUALITY VALIDATION           ');
  console.log('====================================================');

  const report = validateDataset();

  console.log(`Total Curated Images: ${report.totalImages}`);
  console.log('Category Distribution:');
  for (const [cat, count] of Object.entries(report.categoryDistribution)) {
    console.log(`  - ${cat.padEnd(14)}: ${count} images`);
  }

  if (report.missingFiles.length > 0) {
    console.error(`\nMissing Files (${report.missingFiles.length}):`);
    report.missingFiles.forEach((f) => console.error(`  - ${f}`));
  }

  if (report.mismatchedChecksums.length > 0) {
    console.error(`\nMismatched Checksums (${report.mismatchedChecksums.length}):`);
    report.mismatchedChecksums.forEach((m) => console.error(`  - ${m}`));
  }

  if (report.duplicateChecksums.length > 0) {
    console.error(`\nDuplicate Checksums (${report.duplicateChecksums.length}):`);
    report.duplicateChecksums.forEach((d) => console.error(`  - ${d}`));
  }

  if (report.invalidFormats.length > 0) {
    console.error(`\nInvalid Formats (${report.invalidFormats.length}):`);
    report.invalidFormats.forEach((fmt) => console.error(`  - ${fmt}`));
  }

  if (report.errors.length > 0) {
    console.error(`\nValidation Errors (${report.errors.length}):`);
    report.errors.forEach((e) => console.error(`  - ${e}`));
  }

  console.log('----------------------------------------------------');
  if (report.isValid) {
    console.log('✓ DATASET QUALITY CHECK PASSED: 100% compliant.');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error('✗ DATASET QUALITY CHECK FAILED.');
    console.log('====================================================');
    process.exit(1);
  }
}
