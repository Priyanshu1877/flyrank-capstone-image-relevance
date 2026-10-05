export type GuardReasonCode =
  | 'LOW_CONFIDENCE'
  | 'QUARANTINED'
  | 'CATEGORY_MISMATCH'
  | 'SUBJECT_CONFLICT'
  | 'SIMILARITY_BELOW_THRESHOLD'
  | 'INVALID_VECTOR';

export interface SubjectConflictRule {
  domain: string;
  expectedPattern: RegExp;
  conflictingPattern: RegExp;
  rejectionReason: string;
}

/**
 * Extensible declarative taxonomy rules for detecting domain-specific subject conflicts
 * (e.g. blocking gray wolf images for red fox articles despite vector closeness).
 */
export const DEFAULT_SUBJECT_CONFLICT_RULES: SubjectConflictRule[] = [
  // Wildlife: Fox vs Wolf / Coyote
  {
    domain: 'wildlife',
    expectedPattern: /\b(red fox|fox|vulpine|vulpes)\b/i,
    conflictingPattern: /\b(gray wolf|grey wolf|wolf|canis lupus|timber wolf|coyote)\b/i,
    rejectionReason: 'Animal category mismatch: expected fox, detected wolf'
  },
  {
    domain: 'wildlife',
    expectedPattern: /\b(gray wolf|grey wolf|wolf|canis lupus|timber wolf)\b/i,
    conflictingPattern: /\b(red fox|fox|vulpine|vulpes)\b/i,
    rejectionReason: 'Animal category mismatch: expected wolf, detected fox'
  },
  // Wildlife: Bear vs Canine
  {
    domain: 'wildlife',
    expectedPattern: /\b(brown bear|grizzly bear|bear|ursus)\b/i,
    conflictingPattern: /\b(wolf|fox|coyote|dog)\b/i,
    rejectionReason: 'Animal category mismatch: expected bear, detected canine'
  },
  // Wildlife: Otter vs Bear/Wolf
  {
    domain: 'wildlife',
    expectedPattern: /\b(river otter|sea otter|otter|lutra)\b/i,
    conflictingPattern: /\b(bear|wolf|fox)\b/i,
    rejectionReason: 'Animal category mismatch: expected otter, detected other predator'
  },
  // Culinary: Espresso/Coffee vs Tea/Matcha
  {
    domain: 'culinary',
    expectedPattern: /\b(espresso|coffee|latte|cappuccino|caffeine)\b/i,
    conflictingPattern: /\b(matcha|tea|green tea|chai)\b/i,
    rejectionReason: 'Beverage category mismatch: expected coffee/espresso, detected tea/matcha'
  },
  {
    domain: 'culinary',
    expectedPattern: /\b(matcha|tea|green tea)\b/i,
    conflictingPattern: /\b(espresso|coffee|latte|cappuccino)\b/i,
    rejectionReason: 'Beverage category mismatch: expected tea/matcha, detected coffee/espresso'
  },
  // Culinary: Sourdough/Bread vs Pizza/Pasta
  {
    domain: 'culinary',
    expectedPattern: /\b(sourdough|bread loaf|artisan bread|baking)\b/i,
    conflictingPattern: /\b(pizza|pasta|ramen|burger)\b/i,
    rejectionReason: 'Culinary category mismatch: expected bread/sourdough, detected main dish'
  },
  // Technology: Laptop/PC vs Server Rack/Datacenter
  {
    domain: 'technology',
    expectedPattern: /\b(laptop|notebook|ultrabook|macbook)\b/i,
    conflictingPattern: /\b(server rack|datacenter|server blade|mainframe)\b/i,
    rejectionReason:
      'Technology category mismatch: expected personal computer, detected server infrastructure'
  },
  {
    domain: 'technology',
    expectedPattern: /\b(server rack|datacenter|cloud infrastructure|server blade)\b/i,
    conflictingPattern: /\b(laptop|smartphone|tablet)\b/i,
    rejectionReason:
      'Technology category mismatch: expected server infrastructure, detected personal device'
  },
  // Architecture: Brutalist vs Gothic/Historic
  {
    domain: 'architecture',
    expectedPattern: /\b(brutalist|brutalism|concrete structure|monolithic)\b/i,
    conflictingPattern: /\b(gothic|cathedral|pagoda|temple)\b/i,
    rejectionReason:
      'Architectural style mismatch: expected brutalist concrete, detected classical/religious structure'
  },
  {
    domain: 'architecture',
    expectedPattern: /\b(gothic cathedral|cathedral|basilica)\b/i,
    conflictingPattern: /\b(brutalist|skyscraper|bridge|pagoda)\b/i,
    rejectionReason:
      'Architectural style mismatch: expected gothic cathedral, detected modern/secular structure'
  }
];

export function detectSubjectConflict(
  postCategory: string,
  postText: string,
  detectedCategory: string,
  detectedSubject: string,
  rules: SubjectConflictRule[] = DEFAULT_SUBJECT_CONFLICT_RULES
): { hasConflict: boolean; reason?: string } {
  const normPostCat = postCategory.trim().toLowerCase();
  const normDetectedCat = detectedCategory.trim().toLowerCase();

  for (const rule of rules) {
    if (
      rule.domain.toLowerCase() === normPostCat ||
      rule.domain.toLowerCase() === normDetectedCat
    ) {
      const postMatchesExpected = rule.expectedPattern.test(postText);
      const imageMatchesConflicting = rule.conflictingPattern.test(detectedSubject);

      if (postMatchesExpected && imageMatchesConflicting) {
        return {
          hasConflict: true,
          reason: rule.rejectionReason
        };
      }
    }
  }

  return { hasConflict: false };
}
