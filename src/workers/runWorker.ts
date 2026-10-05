import { fileURLToPath } from 'node:url';
import { JobWorker } from './JobWorker.js';
import { resolveVisionProvider, resolveEmbeddingProvider } from '../services/ai/index.js';
import { closePool } from '../config/database.js';

export async function startWorkerCLI(args: string[] = process.argv.slice(2)): Promise<void> {
  let providerType: string | undefined;
  let tenantId: string | undefined;
  let isBatch = false;
  let maxJobs = 1000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && i + 1 < args.length) {
      providerType = args[++i];
    } else if (args[i] === '--tenant-id' && i + 1 < args.length) {
      tenantId = args[++i];
    } else if (args[i] === '--max-jobs' && i + 1 < args.length) {
      const val = parseInt(args[++i] ?? '', 10);
      if (!isNaN(val)) maxJobs = val;
    } else if (args[i] === '--batch') {
      isBatch = true;
    }
  }

  // If no flag supplied, default to batch mode for capstone runs
  if (!args.includes('--daemon')) {
    isBatch = true;
  }

  console.log('====================================================');
  console.log('       FLYRANK BACKGROUND QUEUE WORKER              ');
  console.log('====================================================');
  console.log(`Mode:       ${isBatch ? 'BATCH DRAIN' : 'CONTINUOUS DAEMON'}`);
  console.log(`Provider:   ${providerType || process.env.AI_PROVIDER || 'mock'}`);
  if (tenantId) console.log(`Tenant ID:  ${tenantId}`);

  const visionProvider = resolveVisionProvider(providerType);
  const embeddingProvider = resolveEmbeddingProvider(providerType);

  const worker = new JobWorker({
    tenantId,
    visionProvider,
    embeddingProvider
  });

  // Reclaim any stale locks from past interrupted runs
  const reclaimed = await worker.recoverStaleLocks();
  if (reclaimed > 0) {
    console.log(`[JobWorker] Reclaimed ${reclaimed} stale locked jobs.`);
  }

  if (isBatch) {
    console.log(`[JobWorker] Draining up to ${maxJobs} queued jobs...`);
    const summary = await worker.drain(maxJobs);

    console.log('----------------------------------------------------');
    console.log(`Total Processed:  ${summary.totalProcessed}`);
    console.log(`Succeeded:        ${summary.succeeded}`);
    console.log(`Failed:           ${summary.failed}`);
    console.log(`Budget Rejected:  ${summary.budgetRejected}`);
    console.log('====================================================');

    await closePool();
    process.exit(summary.failed > 0 ? 1 : 0);
  } else {
    console.log('[JobWorker] Starting continuous polling loop (Ctrl+C to stop)...');
    let running = true;
    process.on('SIGINT', () => {
      console.log('\n[JobWorker] Received SIGINT, shutting down cleanly...');
      running = false;
    });

    while (running) {
      const processed = await worker.processNext();
      if (!processed) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    await closePool();
    process.exit(0);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWorkerCLI().catch(async (err) => {
    console.error('[JobWorker] Fatal unhandled worker crash:', err);
    await closePool();
    process.exit(1);
  });
}
