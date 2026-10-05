import crypto from 'node:crypto';
import { TenantRepository } from '../repositories/TenantRepository.js';
import { Tenant } from '../models/types.js';

export interface VerifiedTenantContext {
  tenantId: string;
  tenant: Tenant;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class TenantAccessForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantAccessForbiddenError';
  }
}

export class TenantAuthenticator {
  constructor(private readonly tenantRepo = new TenantRepository()) {}

  /**
   * Hashes a raw API key using SHA-256 for secure database lookup.
   */
  hashApiKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * Authenticates client credentials and verifies tenant identity.
   * A client CANNOT blindly override tenant identity via X-Tenant-ID.
   *
   * @param rawApiKey The API key provided in Authorization header
   * @param claimedTenantId Optional header claimed by client (e.g. X-Tenant-ID)
   */
  async authenticate(
    rawApiKey?: string | null,
    claimedTenantId?: string | null
  ): Promise<VerifiedTenantContext> {
    if (!rawApiKey || !rawApiKey.trim()) {
      throw new AuthenticationError('Missing API key in authorization context');
    }

    const keyHash = this.hashApiKey(rawApiKey.trim());
    const tenant = await this.tenantRepo.findByApiKeyHash(keyHash);

    if (!tenant) {
      throw new AuthenticationError('Invalid API key or unauthorized client credentials');
    }

    // Security Check: If client supplied X-Tenant-ID, verify it matches authenticated tenant
    if (claimedTenantId && claimedTenantId !== tenant.id) {
      throw new TenantAccessForbiddenError(
        `Cross-tenant access forbidden: Authenticated tenant (${tenant.id}) does not match claimed tenant (${claimedTenantId})`
      );
    }

    return {
      tenantId: tenant.id,
      tenant
    };
  }
}
