import { IVisionProvider, VisionAnalysisResult } from './types.js';
import { VisionMetadataInput } from '../../schemas/index.js';

export type MockVisionScenario =
  | 'default'
  | 'high_confidence_fox'
  | 'high_confidence_wolf'
  | 'culinary_espresso'
  | 'tech_laptop'
  | 'architecture_brutalist'
  | 'low_confidence'
  | 'invalid_schema'
  | 'timeout'
  | 'rate_limit'
  | 'server_error'
  | 'custom';

export interface MockVisionOptions {
  scenario?: MockVisionScenario;
  customMetadata?: Partial<VisionMetadataInput>;
  latencyMs?: number;
}

export class MockVisionProvider implements IVisionProvider {
  readonly providerName = 'mock';
  readonly modelName = 'mock-vision-v1';

  private currentScenario: MockVisionScenario;
  private customMetadata?: Partial<VisionMetadataInput>;
  private fixedLatencyMs: number;

  constructor(options: MockVisionOptions = {}) {
    this.currentScenario = options.scenario ?? 'default';
    this.customMetadata = options.customMetadata;
    this.fixedLatencyMs = options.latencyMs ?? 50;
  }

  setScenario(scenario: MockVisionScenario, custom?: Partial<VisionMetadataInput>): void {
    this.currentScenario = scenario;
    if (custom) this.customMetadata = custom;
  }

  async analyzeImage(
    _imageBuffer: Buffer,
    _mimeType: string,
    options?: { prompt?: string; contextHint?: string }
  ): Promise<VisionAnalysisResult> {
    if (this.fixedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.fixedLatencyMs, 20)));
    }

    if (this.currentScenario === 'timeout') {
      const err = new Error('AI Vision request timed out after 30000ms');
      err.name = 'TimeoutError';
      throw err;
    }

    if (this.currentScenario === 'rate_limit') {
      const err = new Error('AI Provider rate limit exceeded (HTTP 429: RESOURCE_EXHAUSTED)');
      (err as unknown as { status: number }).status = 429;
      throw err;
    }

    if (this.currentScenario === 'server_error') {
      const err = new Error('AI Provider internal server error (HTTP 500)');
      (err as unknown as { status: number }).status = 500;
      throw err;
    }

    if (this.currentScenario === 'invalid_schema') {
      // Intentionally return invalid metadata (e.g. confidence > 1.0, subject empty)
      return {
        metadata: {
          subject: '',
          category: 'invalid',
          attributes: [],
          caption: 'short',
          confidence: 2.5
        } as unknown as VisionMetadataInput,
        inputTokens: 250,
        outputTokens: 30,
        totalTokens: 280,
        latencyMs: this.fixedLatencyMs,
        estimatedCostUsd: 0.00005,
        model: this.modelName,
        provider: this.providerName,
        rawResponse: { error: 'malformed_payload' }
      };
    }

    let metadata: VisionMetadataInput;

    if (this.currentScenario === 'high_confidence_fox') {
      metadata = {
        subject: 'red fox',
        category: 'wildlife',
        attributes: ['canine', 'fur', 'red coat', 'bushy tail', 'wildlife', 'outdoors'],
        caption: 'A red fox in natural woodland habitat with vibrant reddish-orange fur.',
        confidence: 0.94
      };
    } else if (this.currentScenario === 'high_confidence_wolf') {
      metadata = {
        subject: 'gray wolf',
        category: 'wildlife',
        attributes: ['canine', 'gray fur', 'predator', 'pack animal', 'wilderness', 'timber wolf'],
        caption: 'A gray wolf standing alert in a temperate coniferous forest.',
        confidence: 0.93
      };
    } else if (this.currentScenario === 'culinary_espresso') {
      metadata = {
        subject: 'espresso',
        category: 'culinary',
        attributes: ['coffee', 'crema', 'caffeine', 'beverage', 'ceramic cup'],
        caption: 'A freshly extracted shot of dark espresso topped with rich hazelnut crema.',
        confidence: 0.96
      };
    } else if (this.currentScenario === 'tech_laptop') {
      metadata = {
        subject: 'laptop',
        category: 'technology',
        attributes: ['computer', 'keyboard', 'screen', 'aluminum body', 'workspace'],
        caption: 'A modern slim laptop computer resting on a clean wooden desk surface.',
        confidence: 0.95
      };
    } else if (this.currentScenario === 'architecture_brutalist') {
      metadata = {
        subject: 'brutalist building',
        category: 'architecture',
        attributes: ['concrete', 'geometric', 'monolithic', 'urban', 'modernist'],
        caption:
          'A striking brutalist concrete structure featuring bold geometric angles and raw textured surfaces.',
        confidence: 0.91
      };
    } else if (this.currentScenario === 'low_confidence') {
      metadata = {
        subject: 'unclear shadow figure',
        category: 'wildlife',
        attributes: ['obscure', 'blurry', 'silhouette'],
        caption:
          'An ambiguous silhouette in dark lighting that is difficult to classify with confidence.',
        confidence: 0.52 // strictly below 0.70 quarantine threshold
      };
    } else if (this.currentScenario === 'custom' && this.customMetadata) {
      metadata = {
        subject: this.customMetadata.subject ?? 'custom subject',
        category: this.customMetadata.category ?? 'wildlife',
        attributes: this.customMetadata.attributes ?? ['attribute1'],
        caption:
          this.customMetadata.caption ?? 'A valid descriptive caption exceeding ten characters.',
        confidence: this.customMetadata.confidence ?? 0.88
      };
    } else {
      // Default: infer context from filename / options or image hash for deterministic test repeatability
      const hint = (options?.contextHint ?? options?.prompt ?? '').toLowerCase();

      // Wildlife
      if (hint.includes('fox')) {
        metadata = {
          subject: 'red fox',
          category: 'wildlife',
          attributes: ['canine', 'red fur', 'woodland', 'bushy tail'],
          caption: 'A red fox resting quietly in a natural woodland clearing.',
          confidence: 0.94
        };
      } else if (hint.includes('wolf')) {
        metadata = {
          subject: 'gray wolf',
          category: 'wildlife',
          attributes: ['canine', 'gray fur', 'predator', 'timber wolf'],
          caption: 'A wild gray wolf watching through snow and alpine forest trees.',
          confidence: 0.93
        };
      } else if (hint.includes('bear')) {
        metadata = {
          subject: 'brown bear',
          category: 'wildlife',
          attributes: ['mammal', 'fur', 'omnivore', 'grizzly', 'forest'],
          caption: 'A large brown bear foraging near an Alaskan river.',
          confidence: 0.93
        };
      } else if (hint.includes('otter')) {
        metadata = {
          subject: 'river otter',
          category: 'wildlife',
          attributes: ['aquatic', 'sleek fur', 'freshwater', 'swimmer'],
          caption: 'A sleek river otter swimming and playing in fresh water.',
          confidence: 0.92
        };
      } else if (hint.includes('deer')) {
        metadata = {
          subject: 'red deer',
          category: 'wildlife',
          attributes: ['antlers', 'herbivore', 'forest', 'stag'],
          caption: 'A red deer standing in an autumn forest.',
          confidence: 0.91
        };
      } else if (hint.includes('eagle')) {
        metadata = {
          subject: 'bald eagle',
          category: 'wildlife',
          attributes: ['raptor', 'bird of prey', 'feathers', 'beak'],
          caption: 'A bald eagle perched on a tree branch.',
          confidence: 0.94
        };
      } else if (hint.includes('tiger')) {
        metadata = {
          subject: 'siberian tiger',
          category: 'wildlife',
          attributes: ['feline', 'stripes', 'predator', 'big cat'],
          caption: 'A siberian tiger walking through snow.',
          confidence: 0.95
        };
      } else if (hint.includes('lion')) {
        metadata = {
          subject: 'african lion',
          category: 'wildlife',
          attributes: ['feline', 'mane', 'predator', 'savanna'],
          caption: 'An african lion resting in savanna grasses.',
          confidence: 0.93
        };
      } else if (hint.includes('owl')) {
        metadata = {
          subject: 'barn owl',
          category: 'wildlife',
          attributes: ['nocturnal', 'wings', 'feathers', 'bird'],
          caption: 'A barn owl with golden and white feathers.',
          confidence: 0.91
        };
      } else if (hint.includes('panda')) {
        metadata = {
          subject: 'giant panda',
          category: 'wildlife',
          attributes: ['bamboo', 'black and white', 'bear', 'herbivore'],
          caption: 'A giant panda eating bamboo stalks.',
          confidence: 0.92
        };
      } else if (hint.includes('zebra')) {
        metadata = {
          subject: 'plains zebra',
          category: 'wildlife',
          attributes: ['stripes', 'equine', 'savanna', 'herd'],
          caption: 'A plains zebra standing on an open grassland.',
          confidence: 0.91
        };
      } else if (hint.includes('giraffe')) {
        metadata = {
          subject: 'african giraffe',
          category: 'wildlife',
          attributes: ['long neck', 'spots', 'herbivore', 'tall'],
          caption: 'An african giraffe browsing acacia foliage.',
          confidence: 0.93
        };
        // Culinary
      } else if (hint.includes('espresso')) {
        metadata = {
          subject: 'espresso coffee',
          category: 'culinary',
          attributes: ['coffee', 'crema', 'dark roast', 'beverage'],
          caption: 'A freshly pulled shot of dark espresso topped with rich crema.',
          confidence: 0.95
        };
      } else if (hint.includes('matcha')) {
        metadata = {
          subject: 'matcha tea',
          category: 'culinary',
          attributes: ['green tea', 'froth', 'ceremony', 'japanese'],
          caption: 'A bowl of vibrant green matcha tea whisked to a delicate foam.',
          confidence: 0.94
        };
      } else if (hint.includes('sourdough')) {
        metadata = {
          subject: 'sourdough bread',
          category: 'culinary',
          attributes: ['artisan bread', 'crust', 'baked', 'fermented'],
          caption: 'A crusty loaf of freshly baked artisan sourdough bread.',
          confidence: 0.93
        };
      } else if (hint.includes('pizza')) {
        metadata = {
          subject: 'neapolitan pizza',
          category: 'culinary',
          attributes: ['wood-fired', 'crust', 'cheese', 'tomato sauce'],
          caption: 'A hot neapolitan pizza baked in a wood-fired oven.',
          confidence: 0.96
        };
      } else if (hint.includes('pasta')) {
        metadata = {
          subject: 'fresh pasta',
          category: 'culinary',
          attributes: ['homemade', 'noodles', 'italian', 'savory'],
          caption: 'Homemade fresh pasta garnished with savory sauce.',
          confidence: 0.94
        };
      } else if (hint.includes('salad')) {
        metadata = {
          subject: 'green salad',
          category: 'culinary',
          attributes: ['vegetables', 'crisp', 'fresh', 'greens'],
          caption: 'A crisp green garden salad with colorful vegetables.',
          confidence: 0.92
        };
      } else if (hint.includes('sushi')) {
        metadata = {
          subject: 'japanese sushi',
          category: 'culinary',
          attributes: ['nigiri', 'raw fish', 'rice', 'seafood'],
          caption: 'An assortment of fresh nigiri and maki sushi rolls.',
          confidence: 0.95
        };
      } else if (hint.includes('croissant')) {
        metadata = {
          subject: 'butter croissant',
          category: 'culinary',
          attributes: ['flaky', 'pastry', 'french', 'buttery'],
          caption: 'A golden flaky french butter croissant.',
          confidence: 0.93
        };
      } else if (hint.includes('burger')) {
        metadata = {
          subject: 'gourmet burger',
          category: 'culinary',
          attributes: ['beef patty', 'bun', 'cheese', 'lettuce'],
          caption: 'A stacked gourmet burger with cheese and brioche bun.',
          confidence: 0.94
        };
      } else if (hint.includes('smoothie')) {
        metadata = {
          subject: 'smoothie bowl',
          category: 'culinary',
          attributes: ['blended fruit', 'berries', 'healthy', 'seeds'],
          caption: 'A vibrant fruit smoothie bowl topped with berries and seeds.',
          confidence: 0.92
        };
      } else if (hint.includes('apple_pie') || hint.includes('pie')) {
        metadata = {
          subject: 'apple pie',
          category: 'culinary',
          attributes: ['baked', 'cinnamon', 'crust', 'dessert'],
          caption: 'A warm baked apple pie with lattice crust.',
          confidence: 0.91
        };
      } else if (hint.includes('ramen')) {
        metadata = {
          subject: 'ramen soup',
          category: 'culinary',
          attributes: ['broth', 'noodles', 'japanese', 'scallions'],
          caption: 'A steaming bowl of japanese ramen noodles with broth and egg.',
          confidence: 0.95
        };
        // Technology
      } else if (hint.includes('laptop')) {
        metadata = {
          subject: 'modern laptop',
          category: 'technology',
          attributes: ['portable', 'screen', 'keyboard', 'computer'],
          caption: 'A slim aluminum laptop computer open on an office desk.',
          confidence: 0.95
        };
      } else if (hint.includes('server')) {
        metadata = {
          subject: 'server rack',
          category: 'technology',
          attributes: ['datacenter', 'compute', 'hardware', 'networking'],
          caption: 'High-density enterprise server racks in a datacenter.',
          confidence: 0.94
        };
      } else if (hint.includes('circuit')) {
        metadata = {
          subject: 'circuit board',
          category: 'technology',
          attributes: ['pcb', 'electronics', 'components', 'chips'],
          caption: 'A green printed circuit board with mounted microchips.',
          confidence: 0.93
        };
      } else if (hint.includes('smartphone')) {
        metadata = {
          subject: 'modern smartphone',
          category: 'technology',
          attributes: ['mobile', 'touchscreen', 'device', 'camera'],
          caption: 'A modern touchscreen smartphone displaying a bright screen.',
          confidence: 0.93
        };
      } else if (hint.includes('robotics')) {
        metadata = {
          subject: 'robotics arm',
          category: 'technology',
          attributes: ['industrial', 'automation', 'arm', 'mechanical'],
          caption: 'An automated industrial robotics arm in precision operation.',
          confidence: 0.94
        };
      } else if (hint.includes('quantum')) {
        metadata = {
          subject: 'quantum computing',
          category: 'technology',
          attributes: ['cryostat', 'processor', 'research', 'superconducting'],
          caption: 'A dilution refrigerator cryostat used in quantum processor research.',
          confidence: 0.92
        };
      } else if (hint.includes('code') || hint.includes('developer')) {
        metadata = {
          subject: 'software development code',
          category: 'technology',
          attributes: ['programming', 'editor', 'syntax', 'software'],
          caption: 'Syntax-highlighted software code displayed on a developer monitor.',
          confidence: 0.93
        };
      } else if (hint.includes('drone')) {
        metadata = {
          subject: 'aerial drone',
          category: 'technology',
          attributes: ['quadcopter', 'camera', 'remote', 'rotors'],
          caption: 'A four-rotor aerial drone hovering in flight.',
          confidence: 0.94
        };
      } else if (hint.includes('cyber') || hint.includes('security')) {
        metadata = {
          subject: 'cyber security',
          category: 'technology',
          attributes: ['encryption', 'protection', 'digital', 'network'],
          caption: 'Digital cyber security lock visualization and network shields.',
          confidence: 0.91
        };
      } else if (hint.includes('vr') || hint.includes('headset')) {
        metadata = {
          subject: 'virtual reality headset',
          category: 'technology',
          attributes: ['immersive', 'goggles', 'spatial', 'gaming'],
          caption: 'A sleek virtual reality headset used for immersive computing.',
          confidence: 0.93
        };
      } else if (hint.includes('fiber')) {
        metadata = {
          subject: 'fiber optics',
          category: 'technology',
          attributes: ['cables', 'speed', 'light', 'telecom'],
          caption: 'Glowing high-speed fiber optic data transmission cables.',
          confidence: 0.92
        };
      } else if (hint.includes('printer') || hint.includes('3d')) {
        metadata = {
          subject: '3d printing',
          category: 'technology',
          attributes: ['additive manufacturing', 'nozzle', 'filament', 'maker'],
          caption: 'A precision 3d printer extruding molten filament.',
          confidence: 0.91
        };
        // Architecture
      } else if (hint.includes('brutalist')) {
        metadata = {
          subject: 'brutalist building',
          category: 'architecture',
          attributes: ['concrete', 'geometric', 'monolithic', 'urban'],
          caption: 'A monumental brutalist structure built with textured raw concrete.',
          confidence: 0.94
        };
      } else if (hint.includes('cathedral')) {
        metadata = {
          subject: 'gothic cathedral',
          category: 'architecture',
          attributes: ['spires', 'vaulting', 'historic', 'stone'],
          caption: 'A medieval gothic cathedral featuring dramatic spires and stone arches.',
          confidence: 0.95
        };
      } else if (hint.includes('pagoda')) {
        metadata = {
          subject: 'japanese pagoda',
          category: 'architecture',
          attributes: ['tiered', 'wooden', 'eaves', 'traditional'],
          caption: 'A multi-tiered wooden japanese pagoda framed by nature.',
          confidence: 0.93
        };
      } else if (hint.includes('skyscraper')) {
        metadata = {
          subject: 'modern skyscraper',
          category: 'architecture',
          attributes: ['high-rise', 'glass', 'steel', 'tower'],
          caption: 'A towering glass-and-steel modern skyscraper reaching into the sky.',
          confidence: 0.94
        };
      } else if (hint.includes('bridge')) {
        metadata = {
          subject: 'suspension bridge',
          category: 'architecture',
          attributes: ['cables', 'span', 'towers', 'engineering'],
          caption: 'A magnificent suspension bridge spanning a scenic bay.',
          confidence: 0.95
        };
      } else if (hint.includes('colosseum')) {
        metadata = {
          subject: 'roman colosseum',
          category: 'architecture',
          attributes: ['ancient', 'amphitheater', 'arches', 'ruins'],
          caption: 'The ancient stone arches of the roman colosseum amphitheater.',
          confidence: 0.96
        };
      } else if (hint.includes('temple')) {
        metadata = {
          subject: 'classical greek temple',
          category: 'architecture',
          attributes: ['columns', 'marble', 'historic', 'classical'],
          caption: 'Historic marble columns of a classical greek temple ruin.',
          confidence: 0.94
        };
      } else if (hint.includes('museum')) {
        metadata = {
          subject: 'contemporary museum',
          category: 'architecture',
          attributes: ['gallery', 'sculptural', 'exhibition', 'modern'],
          caption: 'A contemporary museum hall showcasing sculptural architecture.',
          confidence: 0.92
        };
      } else if (hint.includes('street')) {
        metadata = {
          subject: 'historic european street',
          category: 'architecture',
          attributes: ['cobblestone', 'facades', 'pedestrian', 'old town'],
          caption: 'A picturesque cobblestone street lined with historic facades.',
          confidence: 0.93
        };
      } else if (hint.includes('riad')) {
        metadata = {
          subject: 'moroccan riad courtyard',
          category: 'architecture',
          attributes: ['courtyard', 'tiles', 'fountain', 'moroccan'],
          caption: 'An intimate moroccan riad courtyard with mosaic tile fountain.',
          confidence: 0.94
        };
      } else if (hint.includes('terminal')) {
        metadata = {
          subject: 'futuristic terminal',
          category: 'architecture',
          attributes: ['glass', 'curves', 'transit', 'spacious'],
          caption: 'A futuristic airport terminal with expansive curved glass roofs.',
          confidence: 0.93
        };
      } else if (hint.includes('lighthouse')) {
        metadata = {
          subject: 'coastal lighthouse',
          category: 'architecture',
          attributes: ['beacon', 'cliffs', 'ocean', 'tower'],
          caption: 'A solitary coastal lighthouse perched atop ocean cliffs.',
          confidence: 0.94
        };
      } else {
        metadata = {
          subject: 'curated subject',
          category: 'wildlife',
          attributes: ['natural', 'outdoor', 'specimen'],
          caption: 'A high-resolution photograph capturing an authentic subject in crisp focus.',
          confidence: 0.89
        };
      }
    }

    return {
      metadata,
      inputTokens: 258,
      outputTokens: 52,
      totalTokens: 310,
      latencyMs: this.fixedLatencyMs,
      estimatedCostUsd: 0.00008,
      model: this.modelName,
      provider: this.providerName,
      rawResponse: { mock: true, scenario: this.currentScenario }
    };
  }
}
