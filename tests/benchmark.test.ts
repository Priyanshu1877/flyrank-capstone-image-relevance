import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runBenchmark, BenchmarkReport } from '../scripts/benchmark.js';
import { closePool } from '../src/config/database.js';

describe('Phase 5: Labeled Evaluation Benchmark', () => {
  let report: BenchmarkReport;

  beforeAll(async () => {
    // Run benchmark against default tenant
    report = await runBenchmark('e1f1c7d2-3498-4c1d-84fb-39074742a001');
  });

  afterAll(async () => {
    await closePool();
  });

  it('evaluates at least 10 labeled blog posts', () => {
    expect(report.totalLabeledPosts).toBeGreaterThanOrEqual(10);
  });

  it('achieves Top-1 Precision >= 80%', () => {
    expect(report.measuredTop1Precision).toBeGreaterThanOrEqual(report.targetPrecisionFloor);
    expect(report.targetMet).toBe(true);
  });

  it('records audit rejection reasons across rejected candidates', () => {
    const allReasons = report.evaluations.flatMap((e) => e.rejectionReasonsObserved);
    expect(allReasons).toContain('CATEGORY_MISMATCH');
    expect(allReasons).toContain('SUBJECT_CONFLICT');
  });

  it('accurately matches expected subjects on top-1 predictions', () => {
    const foxEval = report.evaluations.find((e) => e.expectedSubject === 'red fox');
    expect(foxEval).toBeDefined();
    expect(foxEval?.isCorrect).toBe(true);
    expect(foxEval?.matchedSubject).toBe('red fox');

    const wolfEval = report.evaluations.find((e) => e.expectedSubject === 'gray wolf');
    expect(wolfEval).toBeDefined();
    expect(wolfEval?.isCorrect).toBe(true);
    expect(wolfEval?.matchedSubject).toBe('gray wolf');
  });
});
