import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { VisionMetadataSchema } from '../src/schemas/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Security & Governance Auditing', () => {
  it('1. should verify .env is ignored by .gitignore', () => {
    const gitignorePath = path.join(rootDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = gitignoreContent.split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
  });

  it('2. should verify .env.example contains only template placeholders and no secrets', () => {
    const envExamplePath = path.join(rootDir, '.env.example');
    expect(fs.existsSync(envExamplePath)).toBe(true);

    const content = fs.readFileSync(envExamplePath, 'utf-8');
    expect(content).toContain('your_gemini_api_key_here');
    // Ensure no real API key patterns exist
    expect(content).not.toMatch(/AIzaSy[A-Za-z0-9_-]{33}/);
    expect(content).not.toMatch(/gsk_[A-Za-z0-9]{40,}/);
  });

  it('3. should verify no raw secrets or private keys exist across src directory', () => {
    const srcDir = path.join(rootDir, 'src');

    function scanDir(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          const fileContent = fs.readFileSync(fullPath, 'utf-8');
          // Check for hardcoded API keys
          expect(fileContent).not.toMatch(/AIzaSy[A-Za-z0-9_-]{33}/);
          expect(fileContent).not.toMatch(/gsk_[A-Za-z0-9]{40,}/);
          expect(fileContent).not.toMatch(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
        }
      }
    }

    scanDir(srcDir);
  });

  it('4. should verify Zod VisionMetadataSchema rejects malformed and out-of-bounds payloads', () => {
    // Missing required fields
    const missingSubject = {
      category: 'animal',
      caption: 'A red fox in the wild',
      attributes: ['orange'],
      confidence: 0.95
    };
    expect(VisionMetadataSchema.safeParse(missingSubject).success).toBe(false);

    // Confidence exceeds 1.0
    const outOfBoundsConfidence = {
      subject: 'red fox',
      category: 'animal',
      caption: 'A red fox in the wild',
      attributes: ['orange'],
      confidence: 1.5
    };
    expect(VisionMetadataSchema.safeParse(outOfBoundsConfidence).success).toBe(false);

    // Negative confidence
    const negativeConfidence = {
      subject: 'red fox',
      category: 'animal',
      caption: 'A red fox in the wild',
      attributes: ['orange'],
      confidence: -0.1
    };
    expect(VisionMetadataSchema.safeParse(negativeConfidence).success).toBe(false);

    // Valid metadata
    const valid = {
      subject: 'Red Fox',
      category: 'Animal',
      caption: 'A red fox standing in a snowy forest',
      attributes: ['orange fur', 'bushy tail'],
      confidence: 0.94
    };
    const parsed = VisionMetadataSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.subject).toBe('red fox'); // Normalized lowercase
      expect(parsed.data.category).toBe('animal');
    }
  });

  it('5. should verify repositories use parameterized queries without SQL concatenation', () => {
    const reposDir = path.join(rootDir, 'src', 'repositories');
    const files = fs.readdirSync(reposDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    for (const file of files) {
      const content = fs.readFileSync(path.join(reposDir, file), 'utf-8');
      // Ensure no raw template string interpolation of variables directly into WHERE or VALUES clauses
      // e.g. "WHERE tenant_id = '" + tenantId + "'" or `WHERE tenant_id = '${tenantId}'`
      expect(content).not.toMatch(/WHERE\s+tenant_id\s*=\s*['"]\s*\+/i);
      expect(content).not.toMatch(/WHERE\s+tenant_id\s*=\s*'\$\{/i);
    }
  });
});
