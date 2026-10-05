import { PostRepository } from '../../repositories/PostRepository.js';
import { PostVectorRepository } from '../../repositories/PostVectorRepository.js';
import { ImageRepository, CandidateImage } from '../../repositories/ImageRepository.js';
import { SuggestionRepository } from '../../repositories/SuggestionRepository.js';
import { calculateCosineSimilarity } from './cosineSimilarity.js';
import { detectSubjectConflict, GuardReasonCode } from './conflictRules.js';

export interface MatchingOptions {
  similarityThreshold?: number;
  confidenceFloor?: number;
  maxCandidates?: number;
}

export interface CandidateEvaluation {
  imageId: string;
  url: string;
  category: string;
  detectedSubject: string;
  confidence: number;
  similarityScore: number;
  accepted: boolean;
  rejectionReason: GuardReasonCode | null;
  explanation: string;
  rank?: number;
}

export interface MatchingResult {
  postId: string;
  status: 'suggested' | 'no_confident_match';
  bestMatch: CandidateEvaluation | null;
  thresholdUsed: number;
  confidenceFloorUsed: number;
  evaluatedCandidatesCount: number;
  eligibleCandidatesCount: number;
  candidates: CandidateEvaluation[];
}

export class MatchingEngineService {
  private postRepo: PostRepository;
  private postVectorRepo: PostVectorRepository;
  private imageRepo: ImageRepository;
  private suggestionRepo: SuggestionRepository;

  public static readonly DEFAULT_SIMILARITY_THRESHOLD = 0.72;
  public static readonly DEFAULT_CONFIDENCE_FLOOR = 0.7;

  constructor(
    postRepo = new PostRepository(),
    postVectorRepo = new PostVectorRepository(),
    imageRepo = new ImageRepository(),
    suggestionRepo = new SuggestionRepository()
  ) {
    this.postRepo = postRepo;
    this.postVectorRepo = postVectorRepo;
    this.imageRepo = imageRepo;
    this.suggestionRepo = suggestionRepo;
  }

  async matchPost(
    tenantId: string,
    postId: string,
    options: MatchingOptions = {}
  ): Promise<MatchingResult> {
    const similarityThreshold =
      options.similarityThreshold ?? MatchingEngineService.DEFAULT_SIMILARITY_THRESHOLD;
    const confidenceFloor =
      options.confidenceFloor ?? MatchingEngineService.DEFAULT_CONFIDENCE_FLOOR;

    // 1. Retrieve Post
    const post = await this.postRepo.findById(tenantId, postId);
    if (!post) {
      throw new Error(`Post not found: ${postId}`);
    }

    // 2. Retrieve Post Vector
    const postVector = await this.postVectorRepo.findByPostId(tenantId, postId);
    if (!postVector || !postVector.embedding || postVector.embedding.length === 0) {
      throw new Error(`Post vector embedding not found for post: ${postId}`);
    }

    // 3. Candidate Retrieval
    const candidates: CandidateImage[] = await this.imageRepo.listCandidatesForMatching(tenantId);

    const evaluations: CandidateEvaluation[] = [];

    // 4. Multi-Gate Evaluation Pipeline
    for (const candidate of candidates) {
      // Gate 1: Vision confidence & Quarantine Gate
      if (candidate.flagged) {
        evaluations.push({
          imageId: candidate.imageId,
          url: candidate.url,
          category: candidate.category,
          detectedSubject: candidate.subject,
          confidence: candidate.confidence,
          similarityScore: 0,
          accepted: false,
          rejectionReason: 'QUARANTINED',
          explanation: 'Image is flagged or quarantined by safety review'
        });
        continue;
      }

      if (candidate.confidence < confidenceFloor) {
        evaluations.push({
          imageId: candidate.imageId,
          url: candidate.url,
          category: candidate.category,
          detectedSubject: candidate.subject,
          confidence: candidate.confidence,
          similarityScore: 0,
          accepted: false,
          rejectionReason: 'LOW_CONFIDENCE',
          explanation: `Vision confidence ${candidate.confidence.toFixed(2)} is below floor ${confidenceFloor.toFixed(2)}`
        });
        continue;
      }

      // Gate 2: Category Compatibility Gate
      if (post.primaryCategory) {
        const postCat = post.primaryCategory.trim().toLowerCase();
        const candCat = candidate.category.trim().toLowerCase();
        if (postCat !== candCat) {
          evaluations.push({
            imageId: candidate.imageId,
            url: candidate.url,
            category: candidate.category,
            detectedSubject: candidate.subject,
            confidence: candidate.confidence,
            similarityScore: 0,
            accepted: false,
            rejectionReason: 'CATEGORY_MISMATCH',
            explanation: `Category mismatch: post requires '${post.primaryCategory}', candidate is '${candidate.category}'`
          });
          continue;
        }
      }

      // Gate 3: Subject / Entity Conflict Gate
      const postText = `${post.title} ${post.body}`;
      const conflict = detectSubjectConflict(
        post.primaryCategory || 'general',
        postText,
        candidate.category,
        candidate.subject
      );

      if (conflict.hasConflict) {
        evaluations.push({
          imageId: candidate.imageId,
          url: candidate.url,
          category: candidate.category,
          detectedSubject: candidate.subject,
          confidence: candidate.confidence,
          similarityScore: 0,
          accepted: false,
          rejectionReason: 'SUBJECT_CONFLICT',
          explanation: conflict.reason ?? 'Detected subject conflicts with post subject'
        });
        continue;
      }

      // Gate 4: Cosine Similarity Calculation
      const simResult = calculateCosineSimilarity(postVector.embedding, candidate.embedding);

      if (!simResult.isValid) {
        evaluations.push({
          imageId: candidate.imageId,
          url: candidate.url,
          category: candidate.category,
          detectedSubject: candidate.subject,
          confidence: candidate.confidence,
          similarityScore: 0,
          accepted: false,
          rejectionReason: 'INVALID_VECTOR',
          explanation: `Vector similarity error: ${simResult.error ?? 'Invalid vector'}`
        });
        continue;
      }

      const sim = simResult.similarity;

      // Gate 5: Similarity Threshold Gate
      if (sim < similarityThreshold) {
        evaluations.push({
          imageId: candidate.imageId,
          url: candidate.url,
          category: candidate.category,
          detectedSubject: candidate.subject,
          confidence: candidate.confidence,
          similarityScore: Number(sim.toFixed(4)),
          accepted: false,
          rejectionReason: 'SIMILARITY_BELOW_THRESHOLD',
          explanation: `Similarity score ${sim.toFixed(4)} is below threshold ${similarityThreshold.toFixed(4)}`
        });
        continue;
      }

      // Passed all gates!
      evaluations.push({
        imageId: candidate.imageId,
        url: candidate.url,
        category: candidate.category,
        detectedSubject: candidate.subject,
        confidence: candidate.confidence,
        similarityScore: Number(sim.toFixed(4)),
        accepted: true,
        rejectionReason: null,
        explanation: 'Candidate cleared all gates'
      });
    }

    // 5. Eligible Candidate Ranking
    const eligible = evaluations.filter((e) => e.accepted);
    eligible.sort((a, b) => b.similarityScore - a.similarityScore);

    eligible.forEach((item, index) => {
      item.rank = index + 1;
    });

    const isMatchFound = eligible.length > 0;
    const bestMatch: CandidateEvaluation | null = isMatchFound ? (eligible[0] ?? null) : null;

    // 6. Suggestion Persistence (Idempotent: clean old suggestions for this post first)
    await this.suggestionRepo.deleteByPostId(tenantId, postId);

    if (isMatchFound) {
      // Persist ranked eligible suggestions
      for (const item of eligible) {
        await this.suggestionRepo.upsert(tenantId, {
          postId,
          imageId: item.imageId,
          similarityScore: item.similarityScore,
          rank: item.rank ?? 1,
          guardPassed: true,
          rejectionReason: null,
          guardDetails: {
            thresholdUsed: similarityThreshold,
            confidenceFloorUsed: confidenceFloor,
            confidence: item.confidence,
            category: item.category,
            detectedSubject: item.detectedSubject,
            explanation: item.explanation
          },
          status: 'suggested'
        });
      }
    } else {
      // Persist no_confident_match record
      await this.suggestionRepo.upsert(tenantId, {
        postId,
        imageId: null,
        similarityScore: 0,
        rank: 1,
        guardPassed: false,
        rejectionReason: 'NO_CONFIDENT_MATCH',
        guardDetails: {
          thresholdUsed: similarityThreshold,
          confidenceFloorUsed: confidenceFloor,
          evaluatedCandidatesCount: candidates.length,
          rejectionSummary: evaluations.map((e) => ({
            imageId: e.imageId,
            reason: e.rejectionReason,
            score: e.similarityScore
          }))
        },
        status: 'no_confident_match'
      });
    }

    return {
      postId,
      status: isMatchFound ? 'suggested' : 'no_confident_match',
      bestMatch,
      thresholdUsed: similarityThreshold,
      confidenceFloorUsed: confidenceFloor,
      evaluatedCandidatesCount: candidates.length,
      eligibleCandidatesCount: eligible.length,
      candidates: evaluations
    };
  }
}
