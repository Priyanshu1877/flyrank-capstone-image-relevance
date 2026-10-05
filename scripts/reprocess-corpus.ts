import { query, closePool } from '../src/config/database.js';
import { ImageProcessorService } from '../src/services/ImageProcessorService.js';
import { MockVisionProvider } from '../src/services/ai/MockVisionProvider.js';
import { MockEmbeddingProvider } from '../src/services/ai/MockEmbeddingProvider.js';

async function main() {
  const tenantId = 'e1f1c7d2-3498-4c1d-84fb-39074742a001';
  const res = await query<{ id: string; url: string; originalFilename: string }>(
    'SELECT id, url, original_filename AS "originalFilename" FROM images WHERE tenant_id = $1 ORDER BY created_at ASC',
    [tenantId]
  );

  console.log(`Reprocessing ${res.rows.length} images for tenant ${tenantId}...`);

  const processor = new ImageProcessorService();
  const visionProvider = new MockVisionProvider();
  const embeddingProvider = new MockEmbeddingProvider();

  let count = 0;
  for (const row of res.rows) {
    await processor.processImage(tenantId, `reprocess:${row.id}`, row.id, {
      visionProvider,
      embeddingProvider
    });
    count++;
  }

  console.log(`Successfully reprocessed and re-indexed all ${count} images!`);
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
