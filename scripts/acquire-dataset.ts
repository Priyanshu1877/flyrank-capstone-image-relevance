import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface DatasetItemSpec {
  id: string;
  category: 'wildlife' | 'culinary' | 'technology' | 'architecture';
  subject: string;
  filename: string;
  sourceUrl: string;
  fallbackUrls?: string[];
  provider: string;
  author: string;
  license: string;
  attribution: string;
}

export const DATASET_SPEC: DatasetItemSpec[] = [
  // --- WILDLIFE (12 images) ---
  {
    id: 'img_wildlife_01',
    category: 'wildlife',
    subject: 'red fox',
    filename: 'wildlife/wildlife_01_red_fox.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1516934024742-b461fba47600?w=640&q=80',
    provider: 'Unsplash',
    author: 'Ray Hennessy',
    license: 'Unsplash License',
    attribution: 'Photo by Ray Hennessy on Unsplash'
  },
  {
    id: 'img_wildlife_02',
    category: 'wildlife',
    subject: 'gray wolf',
    filename: 'wildlife/wildlife_02_gray_wolf.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1557008075-7f2c5efa4cfd?w=640&q=80',
    provider: 'Unsplash',
    author: 'Philipp Pilz',
    license: 'Unsplash License',
    attribution: 'Photo by Philipp Pilz on Unsplash'
  },
  {
    id: 'img_wildlife_03',
    category: 'wildlife',
    subject: 'brown bear',
    filename: 'wildlife/wildlife_03_brown_bear.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1589656966895-2f33e7653819?w=640&q=80',
    provider: 'Unsplash',
    author: 'Hans-Jurgen Mager',
    license: 'Unsplash License',
    attribution: 'Photo by Hans-Jurgen Mager on Unsplash'
  },
  {
    id: 'img_wildlife_04',
    category: 'wildlife',
    subject: 'river otter',
    filename: 'wildlife/wildlife_04_river_otter.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1606567595334-d39972c85dfd?w=640&q=80',
    fallbackUrls: ['https://images.unsplash.com/photo-1615751072497-5f5169febe17?w=640&q=80'],
    provider: 'Unsplash',
    author: 'Dušan veverkolog',
    license: 'Unsplash License',
    attribution: 'Photo by Dušan veverkolog on Unsplash'
  },
  {
    id: 'img_wildlife_05',
    category: 'wildlife',
    subject: 'red deer',
    filename: 'wildlife/wildlife_05_red_deer.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1484406566174-9da000fda645?w=640&q=80',
    provider: 'Unsplash',
    author: 'Dan Meyers',
    license: 'Unsplash License',
    attribution: 'Photo by Dan Meyers on Unsplash'
  },
  {
    id: 'img_wildlife_06',
    category: 'wildlife',
    subject: 'bald eagle',
    filename: 'wildlife/wildlife_06_bald_eagle.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=640&q=80',
    provider: 'Unsplash',
    author: 'Frank Eiffert',
    license: 'Unsplash License',
    attribution: 'Photo by Frank Eiffert on Unsplash'
  },
  {
    id: 'img_wildlife_07',
    category: 'wildlife',
    subject: 'siberian tiger',
    filename: 'wildlife/wildlife_07_siberian_tiger.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?w=640&q=80',
    provider: 'Unsplash',
    author: 'Frida Lannerström',
    license: 'Unsplash License',
    attribution: 'Photo by Frida Lannerström on Unsplash'
  },
  {
    id: 'img_wildlife_08',
    category: 'wildlife',
    subject: 'african lion',
    filename: 'wildlife/wildlife_08_african_lion.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=640&q=80',
    provider: 'Unsplash',
    author: 'Clément Falize',
    license: 'Unsplash License',
    attribution: 'Photo by Clément Falize on Unsplash'
  },
  {
    id: 'img_wildlife_09',
    category: 'wildlife',
    subject: 'barn owl',
    filename: 'wildlife/wildlife_09_barn_owl.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1507666405895-422eee7d517f?w=640&q=80',
    provider: 'Unsplash',
    author: 'Richard Lee',
    license: 'Unsplash License',
    attribution: 'Photo by Richard Lee on Unsplash'
  },
  {
    id: 'img_wildlife_010',
    category: 'wildlife',
    subject: 'giant panda',
    filename: 'wildlife/wildlife_10_giant_panda.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=640&q=80',
    provider: 'Unsplash',
    author: 'Sid Balachandran',
    license: 'Unsplash License',
    attribution: 'Photo by Sid Balachandran on Unsplash'
  },
  {
    id: 'img_wildlife_011',
    category: 'wildlife',
    subject: 'plains zebra',
    filename: 'wildlife/wildlife_11_plains_zebra.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1535083783855-76ae62b2914e?w=640&q=80',
    provider: 'Unsplash',
    author: 'Ronald Gijezen',
    license: 'Unsplash License',
    attribution: 'Photo by Ronald Gijezen on Unsplash'
  },
  {
    id: 'img_wildlife_012',
    category: 'wildlife',
    subject: 'african giraffe',
    filename: 'wildlife/wildlife_12_african_giraffe.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1549366021-9f761d450615?w=640&q=80',
    provider: 'Unsplash',
    author: 'Vincent van Zalinge',
    license: 'Unsplash License',
    attribution: 'Photo by Vincent van Zalinge on Unsplash'
  },

  // --- CULINARY (12 images) ---
  {
    id: 'img_culinary_01',
    category: 'culinary',
    subject: 'espresso coffee',
    filename: 'culinary/culinary_01_espresso.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=640&q=80',
    provider: 'Unsplash',
    author: 'Nathan Dumlao',
    license: 'Unsplash License',
    attribution: 'Photo by Nathan Dumlao on Unsplash'
  },
  {
    id: 'img_culinary_02',
    category: 'culinary',
    subject: 'matcha tea',
    filename: 'culinary/culinary_02_matcha.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=640&q=80',
    provider: 'Unsplash',
    author: 'Jason Leung',
    license: 'Unsplash License',
    attribution: 'Photo by Jason Leung on Unsplash'
  },
  {
    id: 'img_culinary_03',
    category: 'culinary',
    subject: 'sourdough bread',
    filename: 'culinary/culinary_03_sourdough.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=640&q=80',
    provider: 'Unsplash',
    author: 'Anton Mislawsky',
    license: 'Unsplash License',
    attribution: 'Photo by Anton Mislawsky on Unsplash'
  },
  {
    id: 'img_culinary_04',
    category: 'culinary',
    subject: 'neapolitan pizza',
    filename: 'culinary/culinary_04_pizza.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=640&q=80',
    provider: 'Unsplash',
    author: 'Ivan Torres',
    license: 'Unsplash License',
    attribution: 'Photo by Ivan Torres on Unsplash'
  },
  {
    id: 'img_culinary_05',
    category: 'culinary',
    subject: 'fresh pasta',
    filename: 'culinary/culinary_05_pasta.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=640&q=80',
    provider: 'Unsplash',
    author: 'Eiliv Aceron',
    license: 'Unsplash License',
    attribution: 'Photo by Eiliv Aceron on Unsplash'
  },
  {
    id: 'img_culinary_06',
    category: 'culinary',
    subject: 'green salad',
    filename: 'culinary/culinary_06_salad.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=640&q=80',
    provider: 'Unsplash',
    author: 'Anna Pelzer',
    license: 'Unsplash License',
    attribution: 'Photo by Anna Pelzer on Unsplash'
  },
  {
    id: 'img_culinary_07',
    category: 'culinary',
    subject: 'japanese sushi',
    filename: 'culinary/culinary_07_sushi.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=640&q=80',
    provider: 'Unsplash',
    author: 'Vinicius Benedit',
    license: 'Unsplash License',
    attribution: 'Photo by Vinicius Benedit on Unsplash'
  },
  {
    id: 'img_culinary_08',
    category: 'culinary',
    subject: 'butter croissant',
    filename: 'culinary/culinary_08_croissant.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=640&q=80',
    provider: 'Unsplash',
    author: 'Karly Gomez',
    license: 'Unsplash License',
    attribution: 'Photo by Karly Gomez on Unsplash'
  },
  {
    id: 'img_culinary_09',
    category: 'culinary',
    subject: 'gourmet burger',
    filename: 'culinary/culinary_09_burger.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=640&q=80',
    provider: 'Unsplash',
    author: 'amirali mirhashemian',
    license: 'Unsplash License',
    attribution: 'Photo by amirali mirhashemian on Unsplash'
  },
  {
    id: 'img_culinary_010',
    category: 'culinary',
    subject: 'smoothie bowl',
    filename: 'culinary/culinary_10_smoothie.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=640&q=80',
    provider: 'Unsplash',
    author: 'Jannis Brandt',
    license: 'Unsplash License',
    attribution: 'Photo by Jannis Brandt on Unsplash'
  },
  {
    id: 'img_culinary_011',
    category: 'culinary',
    subject: 'apple pie',
    filename: 'culinary/culinary_11_apple_pie.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?w=640&q=80',
    provider: 'Unsplash',
    author: 'Dilyara Garifullina',
    license: 'Unsplash License',
    attribution: 'Photo by Dilyara Garifullina on Unsplash'
  },
  {
    id: 'img_culinary_012',
    category: 'culinary',
    subject: 'ramen soup',
    filename: 'culinary/culinary_12_ramen.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=640&q=80',
    provider: 'Unsplash',
    author: 'Alex Munsell',
    license: 'Unsplash License',
    attribution: 'Photo by Alex Munsell on Unsplash'
  },

  // --- TECHNOLOGY (12 images) ---
  {
    id: 'img_technology_01',
    category: 'technology',
    subject: 'modern laptop',
    filename: 'technology/technology_01_laptop.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=640&q=80',
    provider: 'Unsplash',
    author: 'Kari Shea',
    license: 'Unsplash License',
    attribution: 'Photo by Kari Shea on Unsplash'
  },
  {
    id: 'img_technology_02',
    category: 'technology',
    subject: 'server rack',
    filename: 'technology/technology_02_server_rack.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=640&q=80',
    provider: 'Unsplash',
    author: 'Thomas Jensen',
    license: 'Unsplash License',
    attribution: 'Photo by Thomas Jensen on Unsplash'
  },
  {
    id: 'img_technology_03',
    category: 'technology',
    subject: 'circuit board',
    filename: 'technology/technology_03_circuit_board.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=640&q=80',
    provider: 'Unsplash',
    author: 'Alexandre Debiève',
    license: 'Unsplash License',
    attribution: 'Photo by Alexandre Debiève on Unsplash'
  },
  {
    id: 'img_technology_04',
    category: 'technology',
    subject: 'modern smartphone',
    filename: 'technology/technology_04_smartphone.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=640&q=80',
    provider: 'Unsplash',
    author: 'Arnel Hasanovic',
    license: 'Unsplash License',
    attribution: 'Photo by Arnel Hasanovic on Unsplash'
  },
  {
    id: 'img_technology_05',
    category: 'technology',
    subject: 'robotics arm',
    filename: 'technology/technology_05_robotics.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=640&q=80',
    provider: 'Unsplash',
    author: 'Possessed Photography',
    license: 'Unsplash License',
    attribution: 'Photo by Possessed Photography on Unsplash'
  },
  {
    id: 'img_technology_06',
    category: 'technology',
    subject: 'quantum computing',
    filename: 'technology/technology_06_quantum_processor.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=640&q=80',
    provider: 'Unsplash',
    author: 'Google DeepMind',
    license: 'Unsplash License',
    attribution: 'Photo by Google DeepMind on Unsplash'
  },
  {
    id: 'img_technology_07',
    category: 'technology',
    subject: 'software development code',
    filename: 'technology/technology_07_developer_code.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=640&q=80',
    provider: 'Unsplash',
    author: 'Fotis Fotopoulos',
    license: 'Unsplash License',
    attribution: 'Photo by Fotis Fotopoulos on Unsplash'
  },
  {
    id: 'img_technology_08',
    category: 'technology',
    subject: 'aerial drone',
    filename: 'technology/technology_08_drone.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=640&q=80',
    provider: 'Unsplash',
    author: 'Ricardo Gomez Angel',
    license: 'Unsplash License',
    attribution: 'Photo by Ricardo Gomez Angel on Unsplash'
  },
  {
    id: 'img_technology_09',
    category: 'technology',
    subject: 'cyber security',
    filename: 'technology/technology_09_cybersecurity.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=640&q=80',
    provider: 'Unsplash',
    author: 'FLY:D',
    license: 'Unsplash License',
    attribution: 'Photo by FLY:D on Unsplash'
  },
  {
    id: 'img_technology_010',
    category: 'technology',
    subject: 'virtual reality headset',
    filename: 'technology/technology_10_vr_headset.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=640&q=80',
    provider: 'Unsplash',
    author: 'Minh Pham',
    license: 'Unsplash License',
    attribution: 'Photo by Minh Pham on Unsplash'
  },
  {
    id: 'img_technology_011',
    category: 'technology',
    subject: 'fiber optics',
    filename: 'technology/technology_11_fiber_optics.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=640&q=80',
    provider: 'Unsplash',
    author: 'Federico Beccari',
    license: 'Unsplash License',
    attribution: 'Photo by Federico Beccari on Unsplash'
  },
  {
    id: 'img_technology_012',
    category: 'technology',
    subject: '3d printing',
    filename: 'technology/technology_12_3d_printer.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=640&q=80',
    provider: 'Unsplash',
    author: 'ThisisEngineering',
    license: 'Unsplash License',
    attribution: 'Photo by ThisisEngineering on Unsplash'
  },

  // --- ARCHITECTURE (12 images) ---
  {
    id: 'img_architecture_01',
    category: 'architecture',
    subject: 'brutalist building',
    filename: 'architecture/architecture_01_brutalist.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=640&q=80',
    provider: 'Unsplash',
    author: 'Simone Hutsch',
    license: 'Unsplash License',
    attribution: 'Photo by Simone Hutsch on Unsplash'
  },
  {
    id: 'img_architecture_02',
    category: 'architecture',
    subject: 'gothic cathedral',
    filename: 'architecture/architecture_02_cathedral.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1544644181-1484b3fdfc62?w=640&q=80',
    provider: 'Unsplash',
    author: 'Clément M.',
    license: 'Unsplash License',
    attribution: 'Photo by Clément M. on Unsplash'
  },
  {
    id: 'img_architecture_03',
    category: 'architecture',
    subject: 'japanese pagoda',
    filename: 'architecture/architecture_03_pagoda.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=640&q=80',
    provider: 'Unsplash',
    author: 'Sora Sagano',
    license: 'Unsplash License',
    attribution: 'Photo by Sora Sagano on Unsplash'
  },
  {
    id: 'img_architecture_04',
    category: 'architecture',
    subject: 'modern skyscraper',
    filename: 'architecture/architecture_04_skyscraper.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=640&q=80',
    provider: 'Unsplash',
    author: 'Sean Pollock',
    license: 'Unsplash License',
    attribution: 'Photo by Sean Pollock on Unsplash'
  },
  {
    id: 'img_architecture_05',
    category: 'architecture',
    subject: 'suspension bridge',
    filename: 'architecture/architecture_05_bridge.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=640&q=80',
    provider: 'Unsplash',
    author: 'Joseph Barrientos',
    license: 'Unsplash License',
    attribution: 'Photo by Joseph Barrientos on Unsplash'
  },
  {
    id: 'img_architecture_06',
    category: 'architecture',
    subject: 'roman colosseum',
    filename: 'architecture/architecture_06_colosseum.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=640&q=80',
    provider: 'Unsplash',
    author: 'David Köhler',
    license: 'Unsplash License',
    attribution: 'Photo by David Köhler on Unsplash'
  },
  {
    id: 'img_architecture_07',
    category: 'architecture',
    subject: 'classical greek temple',
    filename: 'architecture/architecture_07_temple.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1555993539-1732b0258235?w=640&q=80',
    provider: 'Unsplash',
    author: 'Spencer Davis',
    license: 'Unsplash License',
    attribution: 'Photo by Spencer Davis on Unsplash'
  },
  {
    id: 'img_architecture_08',
    category: 'architecture',
    subject: 'contemporary museum',
    filename: 'architecture/architecture_08_museum.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1513584684374-8bab748fbf90?w=640&q=80',
    provider: 'Unsplash',
    author: 'Javier M.',
    license: 'Unsplash License',
    attribution: 'Photo by Javier M. on Unsplash'
  },
  {
    id: 'img_architecture_09',
    category: 'architecture',
    subject: 'historic european street',
    filename: 'architecture/architecture_09_historic_street.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=640&q=80',
    provider: 'Unsplash',
    author: 'Jack Ward',
    license: 'Unsplash License',
    attribution: 'Photo by Jack Ward on Unsplash'
  },
  {
    id: 'img_architecture_010',
    category: 'architecture',
    subject: 'moroccan riad courtyard',
    filename: 'architecture/architecture_10_riad.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=640&q=80',
    provider: 'Unsplash',
    author: 'Annie Spratt',
    license: 'Unsplash License',
    attribution: 'Photo by Annie Spratt on Unsplash'
  },
  {
    id: 'img_architecture_011',
    category: 'architecture',
    subject: 'futuristic terminal',
    filename: 'architecture/architecture_11_terminal.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=640&q=80',
    provider: 'Unsplash',
    author: 'Daniel von Appen',
    license: 'Unsplash License',
    attribution: 'Photo by Daniel von Appen on Unsplash'
  },
  {
    id: 'img_architecture_012',
    category: 'architecture',
    subject: 'coastal lighthouse',
    filename: 'architecture/architecture_12_lighthouse.jpg',
    sourceUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=640&q=80',
    provider: 'Unsplash',
    author: 'Sean Oulashin',
    license: 'Unsplash License',
    attribution: 'Photo by Sean Oulashin on Unsplash'
  }
];

function downloadUrl(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      // Follow redirect if 301 / 302
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return downloadUrl(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        const stat = fs.statSync(destPath);
        resolve(stat.size);
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error(`Timeout downloading ${url}`));
    });
  });
}

export async function acquireDataset(): Promise<void> {
  console.log(`[Acquisition] Starting acquisition of ${DATASET_SPEC.length} curated images...`);
  const acquiredManifestItems = [];

  for (const item of DATASET_SPEC) {
    const destPath = path.join(rootDir, 'data', 'images', item.filename);
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if already downloaded and valid
    let exists = false;
    let bytes = 0;
    if (fs.existsSync(destPath)) {
      bytes = fs.statSync(destPath).size;
      if (bytes > 5000) {
        exists = true;
      }
    }

    if (!exists) {
      console.log(`[Acquisition] Downloading ${item.id}: ${item.subject} (${item.category})...`);
      try {
        bytes = await downloadUrl(item.sourceUrl, destPath);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[Acquisition] Primary URL failed for ${item.id}: ${errorMsg}`);
        let fallbackSuccess = false;
        if (item.fallbackUrls) {
          for (const fallback of item.fallbackUrls) {
            try {
              console.log(`[Acquisition] Trying fallback for ${item.id}: ${fallback}...`);
              bytes = await downloadUrl(fallback, destPath);
              fallbackSuccess = true;
              break;
            } catch {
              // try next
            }
          }
        }
        if (!fallbackSuccess) {
          throw new Error(`Failed to acquire ${item.id} (${item.filename})`, { cause: err });
        }
      }
    }

    const buffer = fs.readFileSync(destPath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    acquiredManifestItems.push({
      id: item.id,
      category: item.category,
      subject: item.subject,
      filename: item.filename,
      fileSizeBytes: bytes,
      format: 'image/jpeg',
      checksumSha256: sha256,
      sourceUrl: item.sourceUrl,
      provider: item.provider,
      author: item.author,
      license: item.license,
      attribution: item.attribution,
      acquiredAt: '2026-10-05'
    });
  }

  // Update data/dataset.manifest.json
  const manifest = {
    version: '1.0',
    status: 'acquired',
    totalImages: acquiredManifestItems.length,
    categories: {
      wildlife: acquiredManifestItems.filter((i) => i.category === 'wildlife').length,
      culinary: acquiredManifestItems.filter((i) => i.category === 'culinary').length,
      technology: acquiredManifestItems.filter((i) => i.category === 'technology').length,
      architecture: acquiredManifestItems.filter((i) => i.category === 'architecture').length
    },
    licensePolicy: 'Permissive licenses only (Unsplash License, CC0/Wikimedia) with attribution',
    images: acquiredManifestItems
  };

  const manifestPath = path.join(rootDir, 'data', 'dataset.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(
    `[Acquisition] Done! Manifest written to data/dataset.manifest.json with ${manifest.totalImages} images.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  acquireDataset()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Acquisition] Fatal acquisition error:', err);
      process.exit(1);
    });
}
