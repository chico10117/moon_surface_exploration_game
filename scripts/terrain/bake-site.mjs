import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, '.cache', 'lunar-source');
const OUTPUT_DIR = path.join(ROOT, 'public', 'data', 'tycho');
const PDS_JP2_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/jp2/ldem_64.jp2';
const PDS_JP2_FILE = path.join(CACHE_DIR, 'ldem_64.jp2');
const PDS_CROP_CACHE_FILE = path.join(CACHE_DIR, 'ldem_64_tycho_crop.f32');
const PDS_CHUNK_FILE = path.join(CACHE_DIR, 'ldem_64_chunk.tif');
const LROC_ALBEDO_PRODUCT_ID = 'WAC_EMP_3BAND_E300S3150_064P';
const LROC_ALBEDO_URL =
  'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/MDR/WAC_EMP/WAC_EMP_3BAND_E300S3150_064P.TIF';
const LROC_ALBEDO_FILE = path.join(CACHE_DIR, 'lroc_wac_emp_3band_e300s3150_064p.tif');
const LROC_ALBEDO_CROP_CACHE_FILE = path.join(CACHE_DIR, 'lroc_wac_emp_3band_e300s3150_064p_tycho_crop.rgba');
const LROC_ALBEDO_WIDTH_SAMPLES = 5760;
const LROC_ALBEDO_HEIGHT_SAMPLES = 3840;
const LROC_ALBEDO_TILE_BOUNDS = {
  lonMin: 270,
  lonMax: 360,
  latMin: -60,
  latMax: 0,
};
const PDS_CROP_CHUNK_SAMPLES = 128;
const PDS_WIDTH_SAMPLES = 23040;
const PDS_HEIGHT_SAMPLES = 11520;
const PDS_TIFF_SIGN_BIAS = 32768;
const PDS_HEIGHT_SCALING = 0.5;
const MOON_RADIUS_METERS = 1_737_400;

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

const topographySource = await loadOrGenerateTopographySource();
const { width, height } = topographySource;
const decodedHeights = topographySource.heights;
const metersPerSampleX = world.widthMeters / (width - 1);
const metersPerSampleZ = world.heightMeters / (height - 1);
const albedoSource = await loadOrGenerateAlbedoSource(
  decodedHeights,
  width,
  height,
  metersPerSampleX,
  metersPerSampleZ,
);
const macroNormalTexture = makeMacroNormalTexture(
  decodedHeights,
  width,
  height,
  metersPerSampleX,
  metersPerSampleZ,
);
const macroOcclusionTexture = makeMacroOcclusionTexture(
  decodedHeights,
  width,
  height,
  metersPerSampleX,
  metersPerSampleZ,
);
const lowHeights = downsample(decodedHeights, width, height, 4);
const lowAlbedo = downsampleTexture(albedoSource.texture, 4);
const lowMacroNormal = downsampleNormalTexture(macroNormalTexture, 4);
const lowMacroOcclusion = downsampleTexture(macroOcclusionTexture, 4);
const detailSurface = makeDetailSurface(1024);

await writePng(path.join(OUTPUT_DIR, 'albedo-high.png'), albedoSource.texture);
await writePng(path.join(OUTPUT_DIR, 'albedo-low.png'), lowAlbedo);
await writePng(path.join(OUTPUT_DIR, 'macro-normal-high.png'), macroNormalTexture);
await writePng(path.join(OUTPUT_DIR, 'macro-normal-low.png'), lowMacroNormal);
await writePng(path.join(OUTPUT_DIR, 'macro-occlusion-high.png'), macroOcclusionTexture);
await writePng(path.join(OUTPUT_DIR, 'macro-occlusion-low.png'), lowMacroOcclusion);
await writePng(path.join(OUTPUT_DIR, 'detail-albedo.png'), detailSurface.albedo);
await writePng(path.join(OUTPUT_DIR, 'detail-normal.png'), detailSurface.normal);

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
  defaultSunPreset: 'survey',
  boundsDegrees: bounds,
  world: {
    widthMeters: world.widthMeters,
    heightMeters: world.heightMeters,
    minHeightMeters: minHeight,
    maxHeightMeters: maxHeight,
    meanHeightMeters: heightSum / decodedHeights.length,
    widthSamples: width,
    heightSamples: height,
    metersPerSampleX,
    metersPerSampleZ,
  },
  grid: SITE.grid,
  spawn: withHeight(
    { lon: SITE.center.lon, lat: SITE.center.lat, headingDegrees: 108 },
    decodedHeights,
    width,
    height,
  ),
  source: {
    topography: topographySource.info,
    albedo: albedoSource.info,
  },
  sunPresets: {
    dawn: { azimuthDegrees: 128, elevationDegrees: 8 },
    noon: { azimuthDegrees: 158, elevationDegrees: 27 },
    survey: { azimuthDegrees: 184, elevationDegrees: 22 },
    lowAngle: { azimuthDegrees: 194, elevationDegrees: 5 },
  },
};

const terrainManifest = {
  albedoLow: '/data/tycho/albedo-low.png',
  albedoHigh: '/data/tycho/albedo-high.png',
  macroNormalLow: '/data/tycho/macro-normal-low.png',
  macroNormalHigh: '/data/tycho/macro-normal-high.png',
  macroOcclusionLow: '/data/tycho/macro-occlusion-low.png',
  macroOcclusionHigh: '/data/tycho/macro-occlusion-high.png',
  detailAlbedo: '/data/tycho/detail-albedo.png',
  detailNormal: '/data/tycho/detail-normal.png',
  materialTuning: {
    macroNormalStrength: 0.58,
    occlusionStrength: 0.12,
    detailAlbedoStrength: 0.12,
    detailNormalStrength: 0.16,
    detailNearRepeat: 0.085,
    detailFarRepeat: 0.022,
    triplanarBlendSharpness: 5.2,
  },
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

async function loadOrGenerateTopographySource() {
  try {
    await ensurePdsCrop();
    const { heights, width, height } = await loadPdsCrop();
    return {
      heights,
      width,
      height,
      info: {
        dataset: 'PDS LOLA LDEM_64 JP2',
        citation:
          'Official LOLA GDR global DEM from the PDS Geosciences Node. JP2 crop samples are decoded from unsigned TIFF output via (value - 32768) * 0.5 meters.',
        sourceUrl: PDS_JP2_URL,
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
          'Generated locally from a crater morphology model because the official PDS JP2 source could not be decoded during bake.',
        sourceUrl: PDS_JP2_URL,
        warning: `Falling back to procedural topography because the PDS JP2 source could not be decoded: ${error.message}`,
      },
    };
  }
}

async function loadOrGenerateAlbedoSource(heights, width, height, stepX, stepZ) {
  try {
    await ensureLrocCrop();
    return {
      texture: await loadLrocCrop(),
      info: {
        dataset: 'LROC WAC Empirically Normalized 3-band mosaic',
        citation:
          'Official 64 px/deg LROC WAC 3-band RGB empirically normalized mosaic (R=689 nm, G=415 nm, B=321 nm), cropped to the Tycho survey window.',
        sourceUrl: LROC_ALBEDO_URL,
        productId: LROC_ALBEDO_PRODUCT_ID,
      },
    };
  } catch (error) {
    console.warn('Falling back to synthetic Tycho albedo:', error.message);
    return {
      texture: makeFallbackAlbedoTexture(heights, width, height, stepX, stepZ),
      info: {
        dataset: 'Synthetic Tycho albedo fallback',
        citation:
          'Generated locally from the Tycho terrain crop because the official LROC WAC 3-band color source was unavailable during bake.',
        sourceUrl: LROC_ALBEDO_URL,
        productId: LROC_ALBEDO_PRODUCT_ID,
        warning: `Falling back to synthetic grayscale albedo because the official LROC WAC color crop was unavailable: ${error.message}`,
      },
    };
  }
}

async function ensurePdsCrop() {
  try {
    await loadPdsCrop();
    return;
  } catch (error) {
    console.warn('PDS crop cache missing or invalid:', error.message);
  }

  try {
    await buildPdsCropCache();
    return;
  } catch (error) {
    console.warn('PDS crop build needs a complete JP2 cache:', error.message);
  }

  await resumeCurlDownload(PDS_JP2_URL, PDS_JP2_FILE);
  await buildPdsCropCache();
}

async function loadPdsCrop() {
  const buffer = await readFile(PDS_CROP_CACHE_FILE);
  const expectedBytes = SITE.widthSamples * SITE.heightSamples * Float32Array.BYTES_PER_ELEMENT;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Unexpected PDS crop cache size ${buffer.byteLength}`);
  }

  const heights = new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );

  return {
    heights,
    width: SITE.widthSamples,
    height: SITE.heightSamples,
  };
}

function decodePdsTiffHeights(values) {
  const decoded = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    decoded[index] = (values[index] - PDS_TIFF_SIGN_BIAS) * PDS_HEIGHT_SCALING;
  }
  return decoded;
}

async function buildPdsCropCache() {
  const heights = await decodePdsCropByChunks();
  await writeFile(
    PDS_CROP_CACHE_FILE,
    Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength),
  );
}

async function decodePdsCropByChunks() {
  const { x0, y0, x1, y1 } = getPdsCropWindow();
  const width = x1 - x0;
  const height = y1 - y0;
  const heights = new Float32Array(width * height);

  for (let rowOffset = 0; rowOffset < height; rowOffset += PDS_CROP_CHUNK_SAMPLES) {
    const chunkHeight = Math.min(PDS_CROP_CHUNK_SAMPLES, height - rowOffset);
    for (let colOffset = 0; colOffset < width; colOffset += PDS_CROP_CHUNK_SAMPLES) {
      const chunkWidth = Math.min(PDS_CROP_CHUNK_SAMPLES, width - colOffset);
      const chunkValues = await decodePdsChunk(
        x0 + colOffset,
        y0 + rowOffset,
        chunkWidth,
        chunkHeight,
      );

      for (let row = 0; row < chunkHeight; row += 1) {
        const targetStart = (rowOffset + row) * width + colOffset;
        const sourceStart = row * chunkWidth;
        heights.set(chunkValues.subarray(sourceStart, sourceStart + chunkWidth), targetStart);
      }
    }
  }

  return heights;
}

async function decodePdsChunk(x0, y0, width, height) {
  await runProcess('opj_decompress', [
    '-i',
    PDS_JP2_FILE,
    '-d',
    `${x0},${y0},${x0 + width},${y0 + height}`,
    '-o',
    PDS_CHUNK_FILE,
    '-quiet',
  ]);

  const tiff = await fromFile(PDS_CHUNK_FILE);
  const image = await tiff.getImage();
  if (image.getWidth() !== width || image.getHeight() !== height) {
    throw new Error(`Unexpected PDS chunk size ${image.getWidth()}x${image.getHeight()}`);
  }

  const raster = await image.readRasters({
    interleave: true,
  });

  return decodePdsTiffHeights(raster);
}

function getPdsCropWindow() {
  const x0 = Math.round(((bounds.lonMin + 180) / 360) * PDS_WIDTH_SAMPLES);
  const y0 = Math.round(((90 - bounds.latMax) / 180) * PDS_HEIGHT_SAMPLES);
  const x1 = x0 + SITE.widthSamples;
  const y1 = y0 + SITE.heightSamples;

  return { x0, y0, x1, y1 };
}

async function ensureLrocCrop() {
  try {
    await loadLrocCrop();
    return;
  } catch (error) {
    console.warn('LROC crop cache missing or invalid:', error.message);
  }

  try {
    await buildLrocCropCache();
    return;
  } catch (error) {
    console.warn('LROC crop build needs a complete TIFF cache:', error.message);
  }

  await resumeCurlDownload(LROC_ALBEDO_URL, LROC_ALBEDO_FILE);
  await buildLrocCropCache();
}

async function loadLrocCrop() {
  const buffer = await readFile(LROC_ALBEDO_CROP_CACHE_FILE);
  const expectedBytes = SITE.widthSamples * SITE.heightSamples * 4;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Unexpected LROC crop cache size ${buffer.byteLength}`);
  }

  return {
    width: SITE.widthSamples,
    height: SITE.heightSamples,
    pixels: new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

async function buildLrocCropCache() {
  const texture = await decodeLrocCrop();
  await writeFile(
    LROC_ALBEDO_CROP_CACHE_FILE,
    Buffer.from(texture.pixels.buffer, texture.pixels.byteOffset, texture.pixels.byteLength),
  );
}

async function decodeLrocCrop() {
  const tiff = await fromFile(LROC_ALBEDO_FILE);
  const image = await tiff.getImage();
  if (
    image.getWidth() !== LROC_ALBEDO_WIDTH_SAMPLES ||
    image.getHeight() !== LROC_ALBEDO_HEIGHT_SAMPLES ||
    image.getSamplesPerPixel() < 3
  ) {
    throw new Error(
      `Unexpected LROC TIFF layout ${image.getWidth()}x${image.getHeight()} with ${image.getSamplesPerPixel()} bands`,
    );
  }

  const { x0, y0, x1, y1 } = getLrocCropWindow();
  const raster = await image.readRasters({
    window: [x0, y0, x1, y1],
    samples: [0, 1, 2],
    interleave: true,
  });
  if (raster.length !== SITE.widthSamples * SITE.heightSamples * 3) {
    throw new Error(`Unexpected LROC raster length ${raster.length}`);
  }

  const pixels = new Uint8Array(SITE.widthSamples * SITE.heightSamples * 4);
  for (let sourceIndex = 0, pixelIndex = 0; sourceIndex < raster.length; sourceIndex += 3, pixelIndex += 4) {
    pixels[pixelIndex] = raster[sourceIndex];
    pixels[pixelIndex + 1] = raster[sourceIndex + 1];
    pixels[pixelIndex + 2] = raster[sourceIndex + 2];
    pixels[pixelIndex + 3] = 255;
  }

  return {
    width: SITE.widthSamples,
    height: SITE.heightSamples,
    pixels,
  };
}

function getLrocCropWindow() {
  const lonMin = normalizePositiveEastLongitude(bounds.lonMin);
  const lonMax = normalizePositiveEastLongitude(bounds.lonMax);
  const x0 = Math.round(
    ((lonMin - LROC_ALBEDO_TILE_BOUNDS.lonMin) /
      (LROC_ALBEDO_TILE_BOUNDS.lonMax - LROC_ALBEDO_TILE_BOUNDS.lonMin)) *
      LROC_ALBEDO_WIDTH_SAMPLES,
  );
  const y0 = Math.round(
    ((LROC_ALBEDO_TILE_BOUNDS.latMax - bounds.latMax) /
      (LROC_ALBEDO_TILE_BOUNDS.latMax - LROC_ALBEDO_TILE_BOUNDS.latMin)) *
      LROC_ALBEDO_HEIGHT_SAMPLES,
  );
  const x1 = x0 + SITE.widthSamples;
  const y1 = y0 + SITE.heightSamples;

  if (
    lonMax > LROC_ALBEDO_TILE_BOUNDS.lonMax ||
    x0 < 0 ||
    y0 < 0 ||
    x1 > LROC_ALBEDO_WIDTH_SAMPLES ||
    y1 > LROC_ALBEDO_HEIGHT_SAMPLES
  ) {
    throw new Error(`Tycho crop window falls outside the LROC albedo tile: ${x0},${y0},${x1},${y1}`);
  }

  return { x0, y0, x1, y1 };
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

function makeMacroNormalTexture(values, width, height, stepX, stepZ) {
  const pixels = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const normal = sampleTerrainNormal(values, width, height, col, row, stepX, stepZ);
      const pointer = (row * width + col) * 4;
      writeEncodedNormal(pixels, pointer, normal);
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

function makeMacroOcclusionTexture(values, width, height, stepX, stepZ) {
  const pixels = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const center = values[row * width + col];
      const normal = sampleTerrainNormal(values, width, height, col, row, stepX, stepZ);
      const slope = clamp01(1 - normal[1]);
      const immediateMean = sampleNeighborhoodMean(values, width, height, col, row, 1);
      const broadMean = sampleNeighborhoodMean(values, width, height, col, row, 3);
      const cavity = clamp01((immediateMean - center) / 180);
      const basin = clamp01((broadMean - center) / 260);
      const exposure = clamp01((center - broadMean) / 320);
      const occlusion = clamp01(0.97 - slope * 0.34 - cavity * 0.26 - basin * 0.18 + exposure * 0.08);
      const value = clampByte(mix(86, 255, occlusion));
      const pointer = (row * width + col) * 4;
      pixels[pointer] = value;
      pixels[pointer + 1] = value;
      pixels[pointer + 2] = value;
      pixels[pointer + 3] = 255;
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

function downsampleTexture(texture, factor) {
  const downWidth = Math.floor((texture.width - 1) / factor) + 1;
  const downHeight = Math.floor((texture.height - 1) / factor) + 1;
  const pixels = new Uint8Array(downWidth * downHeight * 4);

  for (let row = 0; row < downHeight; row += 1) {
    for (let col = 0; col < downWidth; col += 1) {
      const targetPointer = (row * downWidth + col) * 4;
      const sourceX0 = col * factor;
      const sourceY0 = row * factor;
      const sourceX1 = Math.min(texture.width - 1, sourceX0 + factor - 1);
      const sourceY1 = Math.min(texture.height - 1, sourceY0 + factor - 1);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let sampleCount = 0;
      for (let sourceY = sourceY0; sourceY <= sourceY1; sourceY += 1) {
        for (let sourceX = sourceX0; sourceX <= sourceX1; sourceX += 1) {
          const sourcePointer = (sourceY * texture.width + sourceX) * 4;
          sumR += texture.pixels[sourcePointer];
          sumG += texture.pixels[sourcePointer + 1];
          sumB += texture.pixels[sourcePointer + 2];
          sumA += texture.pixels[sourcePointer + 3];
          sampleCount += 1;
        }
      }

      pixels[targetPointer] = clampByte(sumR / sampleCount);
      pixels[targetPointer + 1] = clampByte(sumG / sampleCount);
      pixels[targetPointer + 2] = clampByte(sumB / sampleCount);
      pixels[targetPointer + 3] = clampByte(sumA / sampleCount);
    }
  }

  return {
    width: downWidth,
    height: downHeight,
    pixels,
  };
}

function downsampleNormalTexture(texture, factor) {
  const downWidth = Math.floor((texture.width - 1) / factor) + 1;
  const downHeight = Math.floor((texture.height - 1) / factor) + 1;
  const pixels = new Uint8Array(downWidth * downHeight * 4);

  for (let row = 0; row < downHeight; row += 1) {
    for (let col = 0; col < downWidth; col += 1) {
      const targetPointer = (row * downWidth + col) * 4;
      const sourceX0 = col * factor;
      const sourceY0 = row * factor;
      const sourceX1 = Math.min(texture.width - 1, sourceX0 + factor - 1);
      const sourceY1 = Math.min(texture.height - 1, sourceY0 + factor - 1);
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;

      for (let sourceY = sourceY0; sourceY <= sourceY1; sourceY += 1) {
        for (let sourceX = sourceX0; sourceX <= sourceX1; sourceX += 1) {
          const sourcePointer = (sourceY * texture.width + sourceX) * 4;
          sumX += texture.pixels[sourcePointer] / 255 * 2 - 1;
          sumY += texture.pixels[sourcePointer + 1] / 255 * 2 - 1;
          sumZ += texture.pixels[sourcePointer + 2] / 255 * 2 - 1;
        }
      }

      writeEncodedNormal(
        pixels,
        targetPointer,
        normalize([sumX, sumY, sumZ]),
      );
    }
  }

  return {
    width: downWidth,
    height: downHeight,
    pixels,
  };
}

function makeFallbackAlbedoTexture(values, width, height, stepX, stepZ) {
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (const value of values) {
    minHeight = Math.min(minHeight, value);
    maxHeight = Math.max(maxHeight, value);
  }

  const pixels = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const center = values[row * width + col];
      const left = values[row * width + Math.max(0, col - 1)];
      const right = values[row * width + Math.min(width - 1, col + 1)];
      const lower = values[Math.max(0, row - 1) * width + col];
      const upper = values[Math.min(height - 1, row + 1) * width + col];

      const dx = (right - left) / (2 * stepX);
      const dz = (upper - lower) / (2 * stepZ);
      const normal = normalize([-dx * 16, 1, -dz * 16]);
      const elevation = (center - minHeight) / Math.max(1, maxHeight - minHeight);
      const slope = clamp01(1 - normal[1]);
      const craterTint = Math.pow(1 - elevation, 1.28);
      const ejectaBands = clamp01(
        0.5 +
          Math.sin((col / Math.max(1, width - 1)) * Math.PI * 9 + elevation * 6.2) * 0.12 +
          Math.cos((row / Math.max(1, height - 1)) * Math.PI * 12 - craterTint * 4.8) * 0.08,
      );
      const albedo = clamp01(0.26 + elevation * 0.34 + craterTint * 0.14 + ejectaBands * 0.08 - slope * 0.2);
      const tone = mix(92, 182, albedo);
      const pointer = (row * width + col) * 4;
      pixels[pointer] = clampByte(tone);
      pixels[pointer + 1] = clampByte(tone);
      pixels[pointer + 2] = clampByte(tone);
      pixels[pointer + 3] = 255;
    }
  }

  return {
    width,
    height,
    pixels,
  };
}

function makeDetailSurface(size) {
  const detailHeights = new Float32Array(size * size);
  const craterSeeds = Array.from({ length: 96 }, (_, index) => ({
    x: fract(Math.sin(index * 91.17 + 0.71) * 43758.5453),
    y: fract(Math.sin(index * 53.91 + 1.31) * 12741.381),
    radius: 0.008 + fract(Math.sin(index * 13.4 + 0.91) * 9812.22) * 0.03,
    depth: 0.07 + fract(Math.sin(index * 71.2 + 0.17) * 7441.12) * 0.22,
  }));

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const u = col / size;
      const v = row / size;
      const broadWave = Math.sin((u * 0.86 + v * 1.14) * Math.PI * 10) * 0.16;
      const ridgeWave = Math.sin((u + v) * Math.PI * 28) * 0.12;
      const fineWave =
        Math.sin(u * Math.PI * 72) * Math.cos(v * Math.PI * 65) * 0.06 +
        Math.cos((u * 3.4 - v * 2.1) * Math.PI * 34) * 0.05;
      let micro = broadWave + ridgeWave + fineWave;

      for (const crater of craterSeeds) {
        const dx = torusDistance(u, crater.x);
        const dy = torusDistance(v, crater.y);
        const distance = Math.hypot(dx, dy) / crater.radius;
        if (distance < 1.55) {
          const bowl = Math.exp(-distance * distance * 2.9) * crater.depth;
          const rim = Math.exp(-Math.pow(distance - 0.9, 2) * 38) * crater.depth * 1.35;
          micro += rim - bowl;
        }
      }

      const rays =
        Math.sin((u * 0.72 + v * 1.28) * Math.PI * 24) * 0.07 +
        Math.sin((u * 1.9 - v * 0.42) * Math.PI * 18) * 0.06 +
        Math.cos((u * 0.4 + v * 2.05) * Math.PI * 42) * 0.04;
      detailHeights[row * size + col] = micro + rays;
    }
  }

  const albedoPixels = new Uint8Array(size * size * 4);
  const normalPixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      const tone = clamp01(0.5 + detailHeights[index]);
      const grain = 0.64 + tone * 0.34;
      const value = clampByte(116 + grain * 64);
      const pointer = index * 4;
      albedoPixels[pointer] = value;
      albedoPixels[pointer + 1] = value;
      albedoPixels[pointer + 2] = clampByte(value + 4);
      albedoPixels[pointer + 3] = 255;

      const left = detailHeights[row * size + wrapIndex(col - 1, size)];
      const right = detailHeights[row * size + wrapIndex(col + 1, size)];
      const lower = detailHeights[wrapIndex(row - 1, size) * size + col];
      const upper = detailHeights[wrapIndex(row + 1, size) * size + col];
      const normal = normalize([-(right - left) * 1.75, 1, -(upper - lower) * 1.75]);
      writeEncodedNormal(normalPixels, pointer, normal);
    }
  }

  return {
    albedo: {
      width: size,
      height: size,
      pixels: albedoPixels,
    },
    normal: {
      width: size,
      height: size,
      pixels: normalPixels,
    },
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

async function resumeCurlDownload(url, destination) {
  await runProcess('curl', [
    '-L',
    '-C',
    '-',
    '--retry',
    '8',
    '--retry-all-errors',
    '--connect-timeout',
    '30',
    '--max-time',
    '0',
    '-o',
    destination,
    url,
  ]);
}

async function runProcess(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
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

function sampleTerrainNormal(values, width, height, col, row, stepX, stepZ) {
  const left = values[row * width + clampIndex(col - 1, width)];
  const right = values[row * width + clampIndex(col + 1, width)];
  const lower = values[clampIndex(row - 1, height) * width + col];
  const upper = values[clampIndex(row + 1, height) * width + col];
  const dx = (right - left) / (2 * stepX);
  const dz = (upper - lower) / (2 * stepZ);
  return normalize([-dx, 1, -dz]);
}

function sampleNeighborhoodMean(values, width, height, col, row, radius) {
  let sum = 0;
  let sampleCount = 0;

  for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
    for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) {
        continue;
      }

      const sampleCol = clampIndex(col + colOffset, width);
      const sampleRow = clampIndex(row + rowOffset, height);
      sum += values[sampleRow * width + sampleCol];
      sampleCount += 1;
    }
  }

  return sampleCount > 0 ? sum / sampleCount : values[row * width + col];
}

function writeEncodedNormal(target, pointer, normal) {
  target[pointer] = clampByte((normal[0] * 0.5 + 0.5) * 255);
  target[pointer + 1] = clampByte((normal[1] * 0.5 + 0.5) * 255);
  target[pointer + 2] = clampByte((normal[2] * 0.5 + 0.5) * 255);
  target[pointer + 3] = 255;
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
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

function normalizePositiveEastLongitude(value) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function fract(value) {
  return value - Math.floor(value);
}

function torusDistance(a, b) {
  const delta = Math.abs(a - b);
  return Math.min(delta, 1 - delta);
}

function clampIndex(index, size) {
  return Math.max(0, Math.min(size - 1, index));
}

function wrapIndex(index, size) {
  const wrapped = index % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}
