import { ReviewRepository, CreateReviewDTO } from '../repositories/ReviewRepository.js';
import { SuggestionRepository } from '../repositories/SuggestionRepository.js';
import { Review, ReviewDecision } from '../models/types.js';

export class ReviewService {
  private reviewRepo: ReviewRepository;
  private suggestionRepo: SuggestionRepository;

  constructor(reviewRepo = new ReviewRepository(), suggestionRepo = new SuggestionRepository()) {
    this.reviewRepo = reviewRepo;
    this.suggestionRepo = suggestionRepo;
  }

  async createReview(tenantId: string, data: CreateReviewDTO): Promise<Review> {
    // Cross-tenant verification: Ensure the target suggestion exists and belongs to this tenant
    const suggestion = await this.suggestionRepo.findById(tenantId, data.suggestionId);
    if (!suggestion) {
      throw new Error(`Suggestion not found or access denied: ${data.suggestionId}`);
    }

    if (!['approved', 'rejected', 'modified'].includes(data.decision)) {
      throw new Error(`Invalid review decision: ${data.decision}`);
    }

    return this.reviewRepo.create(tenantId, data);
  }

  async listReviews(
    tenantId: string,
    options: { decision?: ReviewDecision; limit?: number; offset?: number } = {}
  ): Promise<Review[]> {
    return this.reviewRepo.list(tenantId, options);
  }

  async getReviewsForSuggestion(tenantId: string, suggestionId: string): Promise<Review[]> {
    const suggestion = await this.suggestionRepo.findById(tenantId, suggestionId);
    if (!suggestion) {
      throw new Error(`Suggestion not found or access denied: ${suggestionId}`);
    }

    return this.reviewRepo.listBySuggestion(tenantId, suggestionId);
  }
}
