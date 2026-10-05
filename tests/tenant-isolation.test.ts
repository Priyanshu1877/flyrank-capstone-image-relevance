import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePool } from '../src/config/database.js';
import { TenantRepository } from '../src/repositories/TenantRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { PostRepository } from '../src/repositories/PostRepository.js';
import {
  TenantAuthenticator,
  AuthenticationError,
  TenantAccessForbiddenError
} from '../src/utils/auth.js';
import { Tenant } from '../src/models/types.js';

describe('Tenant Isolation & Authentication Security', () => {
  const tenantRepo = new TenantRepository();
  const imageRepo = new ImageRepository();
  const postRepo = new PostRepository();
  const auth = new TenantAuthenticator(tenantRepo);

  let tenantA: Tenant;
  let tenantB: Tenant;
  const rawKeyA = `tenant-a-key-${Date.now()}-${Math.random()}`;
  const rawKeyB = `tenant-b-key-${Date.now()}-${Math.random()}`;

  beforeAll(async () => {
    tenantA = await tenantRepo.create({
      name: 'Tenant Alpha Publications',
      apiKeyHash: auth.hashApiKey(rawKeyA),
      maxBudgetUsd: 10.0
    });

    tenantB = await tenantRepo.create({
      name: 'Tenant Beta Publishing Corp',
      apiKeyHash: auth.hashApiKey(rawKeyB),
      maxBudgetUsd: 15.0
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it('1. should reject authentication if API key is missing or invalid', async () => {
    await expect(auth.authenticate(null)).rejects.toThrow(AuthenticationError);
    await expect(auth.authenticate('')).rejects.toThrow(AuthenticationError);
    await expect(auth.authenticate('invalid-wrong-key')).rejects.toThrow(AuthenticationError);
  });

  it('2. should authenticate valid credentials and resolve verified tenant identity', async () => {
    const contextA = await auth.authenticate(rawKeyA);
    expect(contextA.tenantId).toBe(tenantA.id);
    expect(contextA.tenant.name).toBe('Tenant Alpha Publications');

    const contextB = await auth.authenticate(rawKeyB);
    expect(contextB.tenantId).toBe(tenantB.id);
  });

  it('3. should FORBID cross-tenant spoofing when client claims a different X-Tenant-ID', async () => {
    // Client authenticates with Tenant A's key but claims Tenant B's ID in header
    await expect(auth.authenticate(rawKeyA, tenantB.id)).rejects.toThrow(
      TenantAccessForbiddenError
    );
  });

  it('4. should prevent Tenant A from reading Tenant B images and posts', async () => {
    // Tenant B creates an image and a post
    const imageB = await imageRepo.create(tenantB.id, {
      url: `https://tenant-b-exclusive-${Date.now()}.com/image.jpg`,
      originalFilename: 'beta-doc.jpg'
    });

    const postB = await postRepo.create(tenantB.id, {
      title: 'Secret Beta Article',
      slug: `secret-beta-article-${Date.now()}`,
      body: 'Proprietary content owned strictly by Tenant B.'
    });

    // Tenant A attempts to read Tenant B's image by ID
    const readImageAttempt = await imageRepo.findById(tenantA.id, imageB.id);
    expect(readImageAttempt).toBeNull();

    // Tenant A attempts to read Tenant B's post by ID
    const readPostAttempt = await postRepo.findById(tenantA.id, postB.id);
    expect(readPostAttempt).toBeNull();

    // Tenant A attempts to read Tenant B's post by slug
    const readSlugAttempt = await postRepo.findBySlug(tenantA.id, postB.slug);
    expect(readSlugAttempt).toBeNull();
  });

  it('5. should prevent Tenant A from modifying Tenant B data', async () => {
    // Tenant B creates an image
    const imageB = await imageRepo.create(tenantB.id, {
      url: `https://tenant-b-modify-test-${Date.now()}.com/image.jpg`
    });

    // Tenant A attempts to update the status of Tenant B's image
    const updateAttempt = await imageRepo.updateStatus(tenantA.id, imageB.id, 'completed');
    expect(updateAttempt).toBeNull();

    // Verify Tenant B's image remains unchanged in 'pending' status
    const verifiedImageB = await imageRepo.findById(tenantB.id, imageB.id);
    expect(verifiedImageB?.status).toBe('pending');
  });

  it('6. should prevent Tenant A from deleting Tenant B data', async () => {
    // Tenant B creates a post
    const postB = await postRepo.create(tenantB.id, {
      title: 'Undeletable by Other Tenants',
      slug: `undeletable-post-${Date.now()}`,
      body: 'Protected post content.'
    });

    // Tenant A attempts to delete Tenant B's post
    const deleteAttempt = await postRepo.delete(tenantA.id, postB.id);
    expect(deleteAttempt).toBe(false);

    // Verify Tenant B's post is still present
    const checkPost = await postRepo.findById(tenantB.id, postB.id);
    expect(checkPost).not.toBeNull();
  });
});
