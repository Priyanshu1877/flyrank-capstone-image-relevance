import fs from 'node:fs';
import path from 'node:path';
import { PostRepository } from '../src/repositories/PostRepository.js';
import { PostVectorRepository } from '../src/repositories/PostVectorRepository.js';
import { ImageRepository } from '../src/repositories/ImageRepository.js';
import { SuggestionRepository } from '../src/repositories/SuggestionRepository.js';
import { PostService } from '../src/services/PostService.js';
import { MatchingEngineService } from '../src/services/matching/MatchingEngineService.js';
import { closePool } from '../src/config/database.js';

interface LabeledPost {
  id: string;
  title: string;
  slug: string;
  body: string;
  primaryCategory: string;
  expectedCategory: string;
  expectedSubject: string;
  expectedImageFilename: string;
}

interface BenchmarkDataset {
  version: string;
  posts: LabeledPost[];
  benchmarkTarget: {
    top1PrecisionFloor: number;
    provisionalSimilarityThreshold: number;
    confidenceFloor: number;
  };
}

export interface BenchmarkReport {
  timestamp: string;
  totalLabeledPosts: number;
  correctTop1Matches: number;
  incorrectMatches: number;
  noMatchCases: number;
  measuredTop1Precision: number;
  targetPrecisionFloor: number;
  targetMet: boolean;
  provisionalThresholdUsed: number;
  confidenceFloorUsed: number;
  evaluations: Array<{
    postId: string;
    title: string;
    expectedCategory: string;
    expectedSubject: string;
    expectedFilename: string;
    matchedImageId: string | null;
    matchedCategory: string | null;
    matchedSubject: string | null;
    similarityScore: number | null;
    isCorrect: boolean;
    rejectionReasonsObserved: string[];
  }>;
}

export async function runBenchmark(
  tenantId = 'e1f1c7d2-3498-4c1d-84fb-39074742a001'
): Promise<BenchmarkReport> {
  const datasetPath = path.resolve(process.cwd(), 'data/evaluation.dataset.json');
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Evaluation dataset not found at ${datasetPath}`);
  }

  const rawJson = fs.readFileSync(datasetPath, 'utf8');
  const dataset: BenchmarkDataset = JSON.parse(rawJson);

  const postRepo = new PostRepository();
  const postVectorRepo = new PostVectorRepository();
  const imageRepo = new ImageRepository();
  const suggestionRepo = new SuggestionRepository();
  const postService = new PostService(postRepo, postVectorRepo);
  const matchingEngine = new MatchingEngineService(
    postRepo,
    postVectorRepo,
    imageRepo,
    suggestionRepo
  );

  console.log(`\n===============================================================`);
  console.log(` FlyRank Semantic Matching Engine Benchmark (Phase 5)`);
  console.log(
    ` Labeled Posts: ${dataset.posts.length} | Target Precision: ≥ ${dataset.benchmarkTarget.top1PrecisionFloor * 100}%`
  );
  console.log(
    ` Threshold: ${dataset.benchmarkTarget.provisionalSimilarityThreshold} | Confidence Floor: ${dataset.benchmarkTarget.confidenceFloor}`
  );
  console.log(`===============================================================\n`);

  let correctCount = 0;
  let incorrectCount = 0;
  let noMatchCount = 0;
  const evaluationReports = [];

  // Ensure candidates exist for this tenant (auto-seed from manifest if empty, e.g. in test DB)
  const existingCandidates = await imageRepo.listCandidatesForMatching(tenantId);
  if (existingCandidates.length === 0) {
    console.log(`[Benchmark] Ingesting & processing 48 dataset images for tenant ${tenantId}...`);
    const manifestPath = path.resolve(process.cwd(), 'data/dataset.manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const { ImageProcessorService } = await import('../src/services/ImageProcessorService.js');
      const { MockVisionProvider } = await import('../src/services/ai/MockVisionProvider.js');
      const { MockEmbeddingProvider } = await import('../src/services/ai/MockEmbeddingProvider.js');
      const processor = new ImageProcessorService();
      const vision = new MockVisionProvider();
      const emb = new MockEmbeddingProvider();
      for (const img of manifest.images) {
        const record = await imageRepo.create(tenantId, {
          url: img.sourceUrl,
          originalFilename: img.filename
        });
        await processor.processImage(tenantId, `bench:${record.id}`, record.id, {
          visionProvider: vision,
          embeddingProvider: emb
        });
      }
    }
  }

  for (const labeled of dataset.posts) {
    // Upsert post and compute vector
    const existingPost = await postRepo.findBySlug(tenantId, labeled.slug);
    let postRecord;

    if (!existingPost) {
      const created = await postService.createPost(tenantId, {
        title: labeled.title,
        slug: labeled.slug,
        body: labeled.body,
        primaryCategory: labeled.primaryCategory,
        status: 'published'
      });
      postRecord = created.post;
    } else {
      postRecord = existingPost;
    }

    // Always ensure fresh vector matches current embedding provider
    const text = PostService.buildPostEmbeddingText(postRecord);
    const { MockEmbeddingProvider } = await import('../src/services/ai/MockEmbeddingProvider.js');
    const provider = new MockEmbeddingProvider();
    const res = await provider.generateEmbedding(text);
    await postVectorRepo.upsert(tenantId, {
      postId: postRecord.id,
      modelName: res.model,
      dimensions: res.dimensions,
      embedding: res.embedding
    });

    // Run matching engine
    const matchResult = await matchingEngine.matchPost(tenantId, postRecord.id, {
      similarityThreshold: dataset.benchmarkTarget.provisionalSimilarityThreshold,
      confidenceFloor: dataset.benchmarkTarget.confidenceFloor
    });

    const best = matchResult.bestMatch;
    const reasonsObserved: string[] = matchResult.candidates
      .map((c) => (c.rejectionReason ? String(c.rejectionReason) : ''))
      .filter((r) => r.length > 0);
    const uniqueReasons = Array.from(new Set(reasonsObserved));

    if (!best) {
      noMatchCount++;
      evaluationReports.push({
        postId: postRecord.id,
        title: labeled.title,
        expectedCategory: labeled.expectedCategory,
        expectedSubject: labeled.expectedSubject,
        expectedFilename: labeled.expectedImageFilename,
        matchedImageId: null,
        matchedCategory: null,
        matchedSubject: null,
        similarityScore: null,
        isCorrect: false,
        rejectionReasonsObserved: uniqueReasons
      });
      console.log(`❌ [NO MATCH] "${labeled.title}" -> No confident match cleared all gates.`);
      continue;
    }

    // Check correctness: Category and Subject match ground truth
    const categoryMatches =
      best.category.trim().toLowerCase() === labeled.expectedCategory.trim().toLowerCase();
    const subjectMatches =
      best.detectedSubject
        .trim()
        .toLowerCase()
        .includes(labeled.expectedSubject.trim().toLowerCase()) ||
      labeled.expectedSubject
        .trim()
        .toLowerCase()
        .includes(best.detectedSubject.trim().toLowerCase());

    const isCorrect = categoryMatches && subjectMatches;

    if (isCorrect) {
      correctCount++;
      console.log(
        `✅ [CORRECT]  "${labeled.title.substring(0, 42)}..." -> Match: [${best.category}] ${best.detectedSubject} (sim: ${best.similarityScore})`
      );
    } else {
      incorrectCount++;
      console.log(
        `❌ [INCORRECT] "${labeled.title.substring(0, 42)}..." -> Expected: [${labeled.expectedCategory}] ${labeled.expectedSubject}, Got: [${best.category}] ${best.detectedSubject} (sim: ${best.similarityScore})`
      );
    }

    evaluationReports.push({
      postId: postRecord.id,
      title: labeled.title,
      expectedCategory: labeled.expectedCategory,
      expectedSubject: labeled.expectedSubject,
      expectedFilename: labeled.expectedImageFilename,
      matchedImageId: best.imageId,
      matchedCategory: best.category,
      matchedSubject: best.detectedSubject,
      similarityScore: best.similarityScore,
      isCorrect,
      rejectionReasonsObserved: uniqueReasons
    });
  }

  const measuredPrecision = correctCount / dataset.posts.length;
  const targetMet = measuredPrecision >= dataset.benchmarkTarget.top1PrecisionFloor;

  console.log(`\n===============================================================`);
  console.log(` BENCHMARK RESULTS SUMMARY:`);
  console.log(` Total Labeled Posts : ${dataset.posts.length}`);
  console.log(` Correct Top-1 Matches: ${correctCount}`);
  console.log(` Incorrect Matches    : ${incorrectCount}`);
  console.log(` No Confident Match   : ${noMatchCount}`);
  console.log(
    ` Top-1 Precision      : ${(measuredPrecision * 100).toFixed(2)}% (Target: ≥ ${(dataset.benchmarkTarget.top1PrecisionFloor * 100).toFixed(2)}%)`
  );
  console.log(` Evaluation Status    : ${targetMet ? 'PASSED (Target Met)' : 'FAILED'}`);
  console.log(`===============================================================\n`);

  return {
    timestamp: new Date().toISOString(),
    totalLabeledPosts: dataset.posts.length,
    correctTop1Matches: correctCount,
    incorrectMatches: incorrectCount,
    noMatchCases: noMatchCount,
    measuredTop1Precision: Number(measuredPrecision.toFixed(4)),
    targetPrecisionFloor: dataset.benchmarkTarget.top1PrecisionFloor,
    targetMet,
    provisionalThresholdUsed: dataset.benchmarkTarget.provisionalSimilarityThreshold,
    confidenceFloorUsed: dataset.benchmarkTarget.confidenceFloor,
    evaluations: evaluationReports
  };
}

if (process.argv[1]?.endsWith('benchmark.ts') || process.argv[1]?.endsWith('benchmark.js')) {
  runBenchmark()
    .then((report) => {
      const outDir = path.resolve(process.cwd(), 'data');
      fs.writeFileSync(
        path.join(outDir, 'benchmark.report.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
      console.log(`Saved report to data/benchmark.report.json`);
      return closePool();
    })
    .catch(async (err) => {
      console.error('Benchmark execution error:', err);
      await closePool();
      process.exit(1);
    });
}
