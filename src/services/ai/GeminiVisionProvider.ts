import { IVisionProvider, VisionAnalysisResult } from './types.js';
import { VisionMetadataSchema } from '../../schemas/index.js';

export interface GeminiVisionOptions {
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
}

export class GeminiVisionProvider implements IVisionProvider {
  readonly providerName = 'gemini';
  readonly modelName: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiVisionOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.modelName = options.modelName ?? process.env.GEMINI_VISION_MODEL ?? 'gemini-1.5-flash';
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async analyzeImage(
    imageBuffer: Buffer,
    mimeType: string,
    options?: { prompt?: string; contextHint?: string }
  ): Promise<VisionAnalysisResult> {
    if (!this.apiKey || this.apiKey.trim() === '' || this.apiKey === 'mock-dev-key') {
      throw new Error(
        'Gemini Vision provider cannot execute: Missing or unconfigured GEMINI_API_KEY.'
      );
    }

    const startTime = Date.now();
    const systemPrompt = `You are an AI image classification and relevance system.
Analyze the provided image and output a single JSON object strictly conforming to this schema:
{
  "subject": "primary concrete subject name (lowercase, 2-100 chars, e.g. red fox, espresso, modern laptop)",
  "category": "one of: wildlife, culinary, technology, architecture",
  "attributes": ["list of 3 to 10 specific visual traits or descriptors, lowercase"],
  "caption": "detailed, objective description of the visual scene (10-500 chars)",
  "confidence": 0.95 (float between 0.0 and 1.0 indicating model classification certainty)
}
Return ONLY valid raw JSON without markdown code fences or backticks.`;

    const userPrompt = options?.prompt ?? 'Describe this image accurately for content matching.';
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${encodeURIComponent(
      this.apiKey
    )}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: fullPrompt },
                {
                  inlineData: {
                    mimeType,
                    data: imageBuffer.toString('base64')
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        }),
        signal: controller.signal
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = (err as Error)?.name === 'AbortError';
      const msg = isAbort ? `Request timed out after ${this.timeoutMs}ms` : (err as Error)?.message;
      const error = new Error(`Gemini Vision network error: ${msg}`);
      if (isAbort) error.name = 'TimeoutError';
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(
        `Gemini Vision API returned HTTP ${response.status}: ${response.statusText}`
      );
      (err as unknown as { status: number; details: string }).status = response.status;
      (err as unknown as { status: number; details: string }).details = errText;
      throw err;
    }

    const responseBody = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const rawText = responseBody.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Gemini Vision API returned an empty candidate or text payload');
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawText);
    } catch (jsonErr: unknown) {
      throw new Error(`Gemini Vision returned unparseable JSON: ${(jsonErr as Error)?.message}`, {
        cause: jsonErr
      });
    }

    const validation = VisionMetadataSchema.safeParse(parsedPayload);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Gemini Vision output violated VisionMetadataSchema: ${issues}`);
    }

    const inputTokens = responseBody.usageMetadata?.promptTokenCount ?? 250;
    const outputTokens = responseBody.usageMetadata?.candidatesTokenCount ?? 50;
    const totalTokens = responseBody.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;

    // Gemini 1.5 Flash rates: $0.075 / 1M input tokens, $0.30 / 1M output tokens
    const estimatedCostUsd = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;

    return {
      metadata: validation.data,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      model: this.modelName,
      provider: this.providerName,
      rawResponse:
        typeof parsedPayload === 'object' && parsedPayload !== null
          ? (parsedPayload as Record<string, unknown>)
          : undefined
    };
  }
}
