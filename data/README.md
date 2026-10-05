# Image Corpus Specification & Acquisition Strategy

> **Status**: **Phase 3 Dataset Acquired & Verified**  
> _Notice: 48 high-resolution curated JPEG images have been acquired under the permissive Unsplash License, cataloged in `data/dataset.manifest.json`, verified via SHA-256 checksums and JPEG magic headers, and integrated with an idempotent ingestion pipeline._

---

## 1. Directory Structure

```
data/
  README.md                 # Corpus documentation & licensing policy
  dataset.manifest.json     # Strict Zod-validated catalog of 48 images with hashes & attributions
  validate.ts               # Dataset quality validator (exit 0 on valid, exit 1 on violation)
  ingest.ts                 # Idempotent tenant-authenticated image ingestion pipeline
  images/
    wildlife/               # 12 images: red fox, gray wolf, brown bear, river otter, deer, eagle, etc.
    culinary/               # 12 images: espresso, matcha tea, sourdough bread, pizza, pasta, ramen, etc.
    technology/             # 12 images: laptop, server rack, circuit board, smartphone, robotics, etc.
    architecture/           # 12 images: brutalist concrete, gothic cathedral, pagoda, modern skyscraper, etc.
```

---

## 2. Dataset Scope & Distribution

- **Total Corpus Size**: Exactly 48 curated, real-world images (target 40–100 achieved).
- **Categories**: 4 distinct, mutually exclusive domains (12 images per category):
  1. `wildlife`: 12 images (Red fox, gray wolf, brown bear, river otter, bald eagle, whitetail deer, lion, barn owl, raccoon, arctic fox, humpback whale, tiger).
  2. `culinary`: 12 images (Espresso coffee, matcha tea, sourdough loaf, artisan pizza, fresh pasta, tonkotsu ramen, avocado salad, croissant, sushi platter, acai bowl, street burger, berry dessert).
  3. `technology`: 12 images (Modern laptop, server rack, circuit board, smartphone, robotic arm, quantum processor, developer workstation, drone, server hardware, datacenter hallway, vr headset, cleanroom microelectronics).
  4. `architecture`: 12 images (Brutalist concrete building, gothic cathedral, traditional pagoda, modern glass skyscraper, suspension bridge, ancient roman colosseum, geometric museum, urban transit station, classical temple, spiral staircase, historic city street, modern airport terminal).

- **Format**: `image/jpeg` with valid magic header bytes (`FF D8 FF`).
- **File Sizes**: Ranging from 25 KB to 142 KB (mean: ~62 KB; all > 1 KB).
- **Resolution**: Scaled to standard web-ready 640px width (`w=640&q=80`) for consistent, fast embedding extraction.

---

## 3. Licensing & Attribution Policy

All 48 images are licensed under the **Unsplash License**, which permits:

- Commercial and non-commercial usage without purchasing a license.
- Modification and derivation for machine learning and AI inference.
- Free distribution within software evaluation environments.

Every record in `data/dataset.manifest.json` preserves:

- Canonical `sourceUrl` pointing to the public Unsplash photo page.
- Direct `author` name and photographer profile attribution.
- License identifier: `Unsplash License`.
- Full attribution notice: `<Author> via Unsplash`.
- Acquisition date: `2026-10-05`.
- SHA-256 cryptographic digest of the exact stored file.

---

## 4. Dataset Validation (`data/validate.ts`)

A dedicated quality validation tool validates the entire corpus without modifying files or database state:

```bash
npm run dataset:validate
```

The validation command verifies:

1. **Manifest Integrity**: Conformance to strict Zod `DatasetManifestSchema`.
2. **File Existence**: Confirms all 48 manifest files exist on disk.
3. **Format Integrity**: Validates JPEG magic headers (`0xFF 0xD8 0xFF`) and minimum size (> 1KB).
4. **Cryptographic Checksum**: Verifies SHA-256 hash matches the manifest for every image.
5. **Collision Detection**: Confirms 0 duplicate checksums across distinct images.
6. **Licensing Completeness**: Ensures author, source URL, license, and attribution exist for every record.
7. **Category Quotas**: Confirms >= 10 images per category across all 4 categories.

---

## 5. Ingestion Pipeline (`data/ingest.ts`)

The ingestion pipeline deterministically registers images and queues background processing jobs:

```bash
# Standard ingestion for default editorial tenant
npm run dataset:ingest

# Dry-run mode (verifies files and manifest without writing to database)
npm run dataset:ingest -- --dry-run

# Custom tenant ingestion with explicit API key
npm run dataset:ingest -- --api-key <secret-key> --tenant-id <tenant-uuid>
```

### Ingestion Properties:

- **Tenant Security**: Ingestion requires authentication via `TenantAuthenticator`. Blind caller claims are forbidden.
- **Transactional Atomicity**: Uses `ImageIngestionTransaction` to insert the image record (`status: 'pending'`) and enqueue the processing job (`type: 'PROCESS_IMAGE'`, `status: 'queued'`) in a single PostgreSQL transaction.
- **Idempotency**: Safe to re-run arbitrarily. Duplicate URLs for the same tenant are handled via `ON CONFLICT (tenant_id, url) DO UPDATE`, and processing jobs use deterministic SHA-256 keys based on `${tenantId}:process_image:${imageId}`.
- **Phase Boundary Compliance**: Images remain in `pending` and jobs in `queued`. Vision models and vector embeddings are not invoked until approved in Phase 4.
