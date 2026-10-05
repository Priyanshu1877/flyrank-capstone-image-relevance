import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..', '..');
const imagesBaseDir = path.resolve(projectRootDir, 'data', 'images');

export interface LoadedImage {
  buffer: Buffer;
  mimeType: string;
  source: 'local_disk' | 'remote_network';
}

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Checks whether an IP or hostname is private/local to prevent SSRF vulnerabilities.
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();

  // Localhost aliases
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  ) {
    return true;
  }

  // AWS/GCP/Azure instance metadata endpoints
  if (normalized === '169.254.169.254' || normalized.startsWith('169.254.')) {
    return true;
  }

  // IPv4 Private subnets
  const ipParts = normalized.split('.').map(Number);
  if (ipParts.length === 4 && ipParts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const p0 = ipParts[0];
    const p1 = ipParts[1];
    if (p0 === 10) return true; // 10.0.0.0/8
    if (p0 === 172 && p1 !== undefined && p1 >= 16 && p1 <= 31) return true; // 172.16.0.0/12
    if (p0 === 192 && p1 === 168) return true; // 192.168.0.0/16
    if (p0 === 127) return true; // 127.0.0.0/8 loopback
    if (p0 === 0) return true;
  }

  return false;
}

export function detectMimeType(filePathOrUrl: string): string {
  const lower = filePathOrUrl.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Safely loads image bytes for processing.
 * Priority 1: Verified local disk path inside data/images/ (path traversal protected).
 * Priority 2: Remote HTTPS/HTTP URL (SSRF protected with private network validation).
 */
export async function loadImageBytes(
  url: string,
  originalFilename?: string | null
): Promise<LoadedImage> {
  // Step 1: Check if stored locally in data/images/
  if (originalFilename) {
    const candidatePath = path.resolve(imagesBaseDir, originalFilename);

    // Path traversal containment check: candidatePath MUST start with imagesBaseDir
    if (!candidatePath.startsWith(imagesBaseDir)) {
      throw new SecurityError(
        `Path traversal attempt detected: originalFilename '${originalFilename}' attempts to escape image root.`
      );
    }

    if (fs.existsSync(candidatePath)) {
      const buffer = fs.readFileSync(candidatePath);
      return {
        buffer,
        mimeType: detectMimeType(candidatePath),
        source: 'local_disk'
      };
    }
  }

  // Step 2: Validate Remote URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SecurityError(`Malformed image URL: '${url}'`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new SecurityError(
      `Unsupported protocol '${parsedUrl.protocol}'. Only HTTP and HTTPS are permitted.`
    );
  }

  // SSRF guard
  if (isPrivateOrReservedHost(parsedUrl.hostname)) {
    throw new SecurityError(
      `SSRF protection triggered: Access to private/internal network host '${parsedUrl.hostname}' is prohibited.`
    );
  }

  // Step 3: Fetch remote image with timeout and size limit
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'FlyRank-ImageEngine/1.0 (+https://flyrank.ai)'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Remote image fetch failed with HTTP ${response.status}: ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Size limit check (max 15MB)
    if (buffer.length > 15 * 1024 * 1024) {
      throw new SecurityError('Image size exceeds maximum allowable limit (15MB)');
    }

    const contentType = response.headers.get('content-type') || detectMimeType(url);
    const mimeType = contentType.includes('png')
      ? 'image/png'
      : contentType.includes('webp')
        ? 'image/webp'
        : 'image/jpeg';

    return {
      buffer,
      mimeType,
      source: 'remote_network'
    };
  } finally {
    clearTimeout(timer);
  }
}
