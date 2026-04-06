import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, '.cache', 'lunar-source');
const OUTPUT_DIR = path.join(ROOT, 'public', 'data', 'tycho');
const SOURCE_URL =
  'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif';
const SOURCE_FILE = path.join(CACHE_DIR, 'ldem_64_uint.tif');
const MOON_RADIUS_METERS = 1_737_400;
const SOURCE_OFFSET = 20_000;
const SOURCE_SCALE = 0.5;

const SITE = {
  id: 'tycho',
  title: 'Tycho Survey Corridor',
  description:
    'A rover-first geology survey slice on measured lunar terrain centered on Tycho crater.',
  center: {
    lon: -11.36,
    lat: -43.31,
  },
  widthSamples: 449,
  heightSamples: 385,
  grid: {
    cols: 4,
    rows: 4,
  },
  detailSamplesPerTile: {
    x: 113,
    z: 97,
  },
  bootSamplesPerTile: {
    x: 29,
    z: 25,
  },
};

const lonSpanDegrees = (SITE.widthSamples - 1) / 64;
const latSpanDegrees = (SITE.heightSamples - 1) / 64;
const bounds = {
  lonMin: SITE.center.lon - lonSpanDegrees / 2,
  lonMax: SITE.center.lon + lonSpanDegrees / 2,
  latMin: SITE.center.lat - latSpanDegrees / 2,
  latMax: SITE.center.lat + latSpanDegrees / 2,
};

const world = {
  widthMeters:
    degreesToRadians(bounds.lonMax - bounds.lonMin) *
    MOON_RADIUS_METERS *
    Math.cos(degreesToRadians((bounds.latMin + bounds.latMax) / 2)),
  heightMeters: degreesToRadians(bounds.latMax - bounds.latMin) * MOON_RADIUS_METERS,
};

await mkdir(CACHE_DIR, { recursive: true });
await mkdir(path.join(OUTPUT_DIR, 'boot'), { recursive: true });
await mkdir(path.join(OUTPUT_DIR, 'detail'), { recursive: true });

const source = await loadOrGenerateSource();
const { width, height } = source;
const decodedHeights = source.heights;
const lowHeights = downsample(decodedHeights, width, height, 4);

const highTexture = makeShadedTexture(
  decodedHeights,
  width,
  height,
  world.widthMeters / (width - 1),
  world.heightMeters / (height - 1),
);
const lowTexture = makeShadedTexture(
  lowHeights.values,
  lowHeights.width,
  lowHeights.height,
  world.widthMeters / (lowHeights.width - 1),
  world.heightMeters / (lowHeights.height - 1),
);

await writePng(path.join(OUTPUT_DIR, 'relief-high.png'), highTexture);
await writePng(path.join(OUTPUT_DIR, 'relief-low.png'), lowTexture);

const tileManifest = buildTileManifest();
await writeTiles(
  decodedHeights,
  width,
  height,
  tileManifest,
  'detail',
  SITE.detailSamplesPerTile,
  1,
);
await writeTiles(
  lowHeights.values,
  lowHeights.width,
  lowHeights.height,
  tileManifest,
  'boot',
  SITE.bootSamplesPerTile,
  1,
);

let minHeight = Infinity;
let maxHeight = -Infinity;
let heightSum = 0;
for (const value of decodedHeights) {
  minHeight = Math.min(minHeight, value);
  maxHeight = Math.max(maxHeight, value);
  heightSum += value;
}

const siteManifest = {
  id: SITE.id,
  title: SITE.title,
  description: SITE.description,
  boundsDegrees: bounds,
  world: {
    widthMeters: world.widthMeters,
    heightMeters: world.heightMeters,
    minHeightMeters: minHeight,
    maxHeightMeters: maxHeight,
    meanHeightMeters: heightSum / decodedHeights.length,
    widthSamples: width,
    heightSamples: height,
    metersPerSampleX: world.widthMeters / (width - 1),
    metersPerSampleZ: world.heightMeters / (height - 1),
  },
  grid: SITE.grid,
  spawn: withHeight(
    { lon: -13.85, lat: -41.48, headingDegrees: 108 },
    decodedHeights,
    width,
    height,
  ),
  source: source.info,
  sunPresets: {
    dawn: { azimuthDegrees: 128, elevationDegrees: 8 },
    noon: { azimuthDegrees: 158, elevationDegrees: 27 },
    lowAngle: { azimuthDegrees: 194, elevationDegrees: 5 },
  },
};

const terrainManifest = {
  textureLow: '/data/tycho/relief-low.png',
  textureHigh: '/data/tycho/relief-high.png',
  levels: [
    { id: 'boot', samplesX: SITE.bootSamplesPerTile.x, samplesZ: SITE.bootSamplesPerTile.z },
    { id: 'detail', samplesX: SITE.detailSamplesPerTile.x, samplesZ: SITE.detailSamplesPerTile.z },
  ],
  tiles: tileManifest,
};

const missionManifest = {
  title: 'Log Three Geology Passes',
  briefing:
    'Drive the survey rover into Tycho, stabilize inside each scan halo, and hold E to log the anomaly. Return to deployment when all three passes are sealed.',
  objectives: [
    withHeight(
      {
        id: 'rim-west',
        label: 'Western Rim Shear',
        note: 'Basalt-highland transition on the northwest inner wall.',
        lon: -13.38,
        lat: -42.35,
        radiusMeters: 4200,
        scanDurationSeconds: 3.4,
      },
      decodedHeights,
      width,
      height,
    ),
    withHeight(
      {
        id: 'floor-breach',
        label: 'Floor Breach',
        note: 'Interior flat with ejecta overlays and slumped crater floor material.',
        lon: -11.56,
        lat: -43.28,
        radiusMeters: 4200,
        scanDurationSeconds: 4.2,
      },
      decodedHeights,
      width,
      height,
    ),
    withHeight(
      {
        id: 'east-rim',
        label: 'Eastern Rim Crest',
        note: 'Brighter uplifted shoulder on the exit rim.',
        lon: -9.42,
        lat: -43.02,
        radiusMeters: 4200,
        scanDurationSeconds: 3.8,
      },
      decodedHeights,
      width,
      height,
    ),
  ],
  returnZone: withHeight(
    {
      id: 'return-zone',
      label: 'Deployment Zone',
      note: 'Return marker at the northwest staging ridge.',
      lon: -13.85,
      lat: -41.48,
      radiusMeters: 5000,
      scanDurationSeconds: 0,
    },
    decodedHeights,
    width,
    height,
  ),
};

await writeJson(path.join(OUTPUT_DIR, 'site-manifest.json'), siteManifest);
await writeJson(path.join(OUTPUT_DIR, 'terrain-lod.json'), terrainManifest);
await writeJson(path.join(OUTPUT_DIR, 'mission.json'), missionManifest);

console.log(`Baked Tycho corridor to ${OUTPUT_DIR}`);

async function loadOrGenerateSource() {
  try {
    await ensureDownload(SOURCE_URL, SOURCE_FILE);
    const { heights, width, height } = await loadCrop();
    return {
      heights: decodeHeights(heights),
      width,
      height,
      info: {
        dataset: 'NASA SVS CGI Moon Kit displacement map derived from LOLA global DEM (64 px/deg)',
        citation:
          'The displacement map is reformatted from LOLA gridded elevation data and exposed as uint16 half-meter offsets.',
        sourceUrl: SOURCE_URL,
      },
    };
  } catch (error) {
    console.warn('Falling back to procedural Tycho terrain:', error.message);
    return {
      heights: generateProceduralTycho(),
      width: SITE.widthSamples,
      height: SITE.heightSamples,
      info: {
        dataset: 'Procedural Tycho fallback',
        citation:
          'Generated locally from a crater morphology model because the remote NASA TIFF host timed out during bake.',
        sourceUrl: SOURCE_URL,
      },
    };
  }
}

async function loadCrop() {
  const tiff = await fromFile(SOURCE_FILE);
  const image = await tiff.getImage();
  const x0 = Math.round(((bounds.lonMin + 180) / 360) * image.getWidth());
  const y0 = Math.round(((90 - bounds.latMax) / 180) * image.getHeight());
  const x1 = x0 + SITE.widthSamples;
  const y1 = y0 + SITE.heightSamples;
  const raster = await image.readRasters({
    window: [x0, y0, x1, y1],
    interleave: true,
  });

  return {
    heights: raster,
    width: SITE.widthSamples,
    height: SITE.heightSamples,
  };
}

function decodeHeights(values) {
  const decoded = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    decoded[index] = (values[index] - SOURCE_OFFSET) * SOURCE_SCALE;
  }
  return decoded;
}

function generateProceduralTycho() {
  const values = new Float32Array(SITE.widthSamples * SITE.heightSamples);
  const centerX = SITE.widthSamples * 0.51;
  const centerY = SITE.heightSamples * 0.54;
  const craterRadius = SITE.widthSamples * 0.28;
  const floorRadius = craterRadius * 0.56;
  const rimRadius = craterRadius * 1.05;

  for (let row = 0; row < SITE.heightSamples; row += 1) {
    for (let col = 0; col < SITE.widthSamples; col += 1) {
      const dx = col - centerX;
      const dy = row - centerY;
      const radius = Math.hypot(dx, dy);
      const normalized = radius / craterRadius;
      const angle = Math.atan2(dy, dx);

      const regionalSlope = (row / SITE.heightSamples - 0.45) * 620 + (col / SITE.widthSamples - 0.58) * 340;
      const craterBowl = -2100 * Math.exp(-Math.pow(normalized / 0.82, 2.4));
      const flatFloor = normalized < floorRadius / craterRadius ? 520 : 0;
      const rim = 1180 * Math.exp(-Math.pow((radius - rimRadius) / (craterRadius * 0.12), 2));
      const outerTerrace = 420 * Math.exp(-Math.pow((radius - craterRadius * 1.34) / (craterRadius * 0.16), 2));
      const centralPeak =
        950 * Math.exp(-Math.pow((dx + craterRadius * 0.08) / (craterRadius * 0.15), 2) - Math.pow((dy - craterRadius * 0.06) / (craterRadius * 0.12), 2)) +
        640 * Math.exp(-Math.pow((dx - craterRadius * 0.07) / (craterRadius * 0.11), 2) - Math.pow((dy + craterRadius * 0.03) / (craterRadius * 0.09), 2));
      const ejectaRays =
        260 *
        Math.exp(-Math.pow((radius - craterRadius * 1.75) / (craterRadius * 0.44), 2)) *
        (0.5 + 0.5 * Math.cos(angle * 7 + normalized * 9));
      const micro =
        Math.sin(col * 0.043) * 62 +
        Math.cos(row * 0.037) * 54 +
        Math.sin((col + row) * 0.018) * 96 +
        Math.cos((col * 0.11) - (row * 0.07)) * 38;
      const subCraterA = -240 * Math.exp(-Math.pow((dx + craterRadius * 0.34) / (craterRadius * 0.12), 2) - Math.pow((dy - craterRadius * 0.48) / (craterRadius * 0.14), 2));
      const subCraterB = -180 * Math.exp(-Math.pow((dx - craterRadius * 0.53) / (craterRadius * 0.1), 2) - Math.pow((dy + craterRadius * 0.29) / (craterRadius * 0.12), 2));

      values[row * SITE.widthSamples + col] =
        regionalSlope +
        craterBowl +
        flatFloor +
        rim +
        outerTerrace +
        centralPeak +
        ejectaRays +
        micro +
        subCraterA +
        subCraterB +
        150;
    }
  }

  return values;
}

function downsample(values, width, height, factor) {
  const downWidth = Math.floor((width - 1) / factor) + 1;
  const downHeight = Math.floor((height - 1) / factor) + 1;
  const next = new Float32Array(downWidth * downHeight);

  for (let row = 0; row < downHeight; row += 1) {
    for (let col = 0; col < downWidth; col += 1) {
      const sourceX = Math.min(width - 1, col * factor);
      const sourceY = Math.min(height - 1, row * factor);
      next[row * downWidth + col] = values[sourceY * width + sourceX];
    }
  }

  return {
    values: next,
    width: downWidth,
    height: downHeight,
  };
}

function makeShadedTexture(values, width, height, stepX, stepZ) {
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (const value of values) {
    minHeight = Math.min(minHeight, value);
    maxHeight = Math.max(maxHeight, value);
  }

  const pixels = new Uint8Array(width * height * 4);
  const sun = normalize([0.48, 0.83, -0.27]);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const center = values[row * width + col];
      const left = values[row * width + Math.max(0, col - 1)];
      const right = values[row * width + Math.min(width - 1, col + 1)];
      const down = values[Math.max(0, row - 1) * width + col];
      const up = values[Math.min(height - 1, row + 1) * width + col];

      const dx = (right - left) / (2 * stepX);
      const dz = (up - down) / (2 * stepZ);
      const normal = normalize([-dx * 16, 1, -dz * 16]);
      const diffuse = Math.max(0.2, dot(normal, sun) * 0.88 + 0.22);
      const elevation = (center - minHeight) / Math.max(1, maxHeight - minHeight);
      const roughness = Math.min(1, Math.abs(dx) * 1200 + Math.abs(dz) * 1200);
      const craterTint = Math.pow(1 - elevation, 1.35);

      const base = {
        r: mix(108, 215, elevation * 0.82 + craterTint * 0.12),
        g: mix(102, 196, elevation * 0.8 + craterTint * 0.1),
        b: mix(96, 176, elevation * 0.77),
      };

      const lightness = diffuse * (0.9 - roughness * 0.25);
      const pointer = (row * width + col) * 4;
      pixels[pointer] = clampByte(base.r * lightness);
      pixels[pointer + 1] = clampByte(base.g * lightness);
      pixels[pointer + 2] = clampByte(base.b * (lightness + 0.04));
      pixels[pointer + 3] = 255;
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

function buildTileManifest() {
  const tiles = [];
  const tileWidthMeters = world.widthMeters / SITE.grid.cols;
  const tileHeightMeters = world.heightMeters / SITE.grid.rows;

  for (let row = 0; row < SITE.grid.rows; row += 1) {
    for (let col = 0; col < SITE.grid.cols; col += 1) {
      const key = `r${row}c${col}`;
      tiles.push({
        key,
        row,
        col,
        boundsMeters: {
          minX: -world.widthMeters / 2 + col * tileWidthMeters,
          maxX: -world.widthMeters / 2 + (col + 1) * tileWidthMeters,
          minZ: -world.heightMeters / 2 + row * tileHeightMeters,
          maxZ: -world.heightMeters / 2 + (row + 1) * tileHeightMeters,
        },
        uvBounds: {
          u0: col / SITE.grid.cols,
          u1: (col + 1) / SITE.grid.cols,
          v0: row / SITE.grid.rows,
          v1: (row + 1) / SITE.grid.rows,
        },
        files: {
          boot: `/data/tycho/boot/${key}.bin`,
          detail: `/data/tycho/detail/${key}.bin`,
        },
      });
    }
  }

  return tiles;
}

async function writeTiles(values, width, height, tiles, levelId, tileResolution, step) {
  const cellsPerTileX = tileResolution.x - 1;
  const cellsPerTileZ = tileResolution.z - 1;

  for (const tile of tiles) {
    const startX = tile.col * cellsPerTileX * step;
    const startZ = tile.row * cellsPerTileZ * step;
    const next = new Float32Array(tileResolution.x * tileResolution.z);

    for (let row = 0; row < tileResolution.z; row += 1) {
      for (let col = 0; col < tileResolution.x; col += 1) {
        const sourceX = Math.min(width - 1, startX + col * step);
        const sourceZ = Math.min(height - 1, startZ + row * step);
        next[row * tileResolution.x + col] = values[sourceZ * width + sourceX];
      }
    }

    await writeFile(path.join(OUTPUT_DIR, levelId, `${tile.key}.bin`), Buffer.from(next.buffer));
  }
}

function withHeight(data, values, width, height) {
  const worldPosition = toWorldPosition(data.lon, data.lat);
  return {
    ...data,
    x: worldPosition.x,
    y: sampleHeight(values, width, height, worldPosition.x, worldPosition.z),
    z: worldPosition.z,
  };
}

function toWorldPosition(lon, lat) {
  const x = ((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) - 0.5) * world.widthMeters;
  const z = ((bounds.latMax - lat) / (bounds.latMax - bounds.latMin) - 0.5) * world.heightMeters;
  return { x, z };
}

function sampleHeight(values, width, height, x, z) {
  const u = ((x / world.widthMeters) + 0.5) * (width - 1);
  const v = ((z / world.heightMeters) + 0.5) * (height - 1);

  const x0 = Math.max(0, Math.min(width - 1, Math.floor(u)));
  const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
  const z0 = Math.max(0, Math.min(height - 1, Math.floor(v)));
  const z1 = Math.max(0, Math.min(height - 1, z0 + 1));
  const tx = u - x0;
  const tz = v - z0;

  const h00 = values[z0 * width + x0];
  const h10 = values[z0 * width + x1];
  const h01 = values[z1 * width + x0];
  const h11 = values[z1 * width + x1];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
}

async function ensureDownload(url, destination) {
  try {
    await stat(destination);
    return;
  } catch {
    console.log(`Downloading source DEM from ${url}`);
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}`);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  const fileStream = createWriteStream(destination);
  const reader = response.body.getReader();
  let receivedBytes = 0;
  let lastCheckpoint = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    receivedBytes += value.byteLength;
    fileStream.write(Buffer.from(value));

    if (totalBytes > 0 && receivedBytes - lastCheckpoint > totalBytes * 0.1) {
      console.log(`Download ${((receivedBytes / totalBytes) * 100).toFixed(0)}%`);
      lastCheckpoint = receivedBytes;
    }
  }

  await new Promise((resolve, reject) => {
    fileStream.end((error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });
}

async function writePng(destination, texture) {
  const png = new PNG({ width: texture.width, height: texture.height });
  png.data = Buffer.from(texture.pixels);
  const chunks = [];

  await new Promise((resolve, reject) => {
    png
      .pack()
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', resolve)
      .on('error', reject);
  });

  await writeFile(destination, Buffer.concat(chunks));
}

async function writeJson(destination, payload) {
  await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}
