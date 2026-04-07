import * as THREE from 'three';
import type {
  LoadedSiteData,
  MissionManifest,
  SiteManifest,
  TerrainLodManifest,
  TerrainTileManifest,
} from '../types';

const BASE_URL = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export async function loadSiteData(): Promise<LoadedSiteData> {
  const [site, terrain, mission] = await Promise.all([
    loadJson<SiteManifest>('data/tycho/site-manifest.json'),
    loadJson<TerrainLodManifest>('data/tycho/terrain-lod.json'),
    loadJson<MissionManifest>('data/tycho/mission.json'),
  ]);

  return { site, terrain, mission };
}

export async function loadColorTexture(url: string): Promise<THREE.Texture> {
  return loadTexture(url, THREE.SRGBColorSpace);
}

export async function loadLinearTexture(url: string): Promise<THREE.Texture> {
  return loadTexture(url, THREE.NoColorSpace);
}

export async function loadRepeatingColorTexture(url: string): Promise<THREE.Texture> {
  const texture = await loadColorTexture(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export async function loadRepeatingLinearTexture(url: string): Promise<THREE.Texture> {
  const texture = await loadLinearTexture(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

async function loadTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const texture = await loader.loadAsync(resolveGameAssetUrl(url));
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

export async function loadTileHeights(tile: TerrainTileManifest, levelId: string): Promise<Float32Array> {
  const response = await fetch(resolveGameAssetUrl(tile.files[levelId]));
  if (!response.ok) {
    throw new Error(`Failed to fetch terrain tile ${tile.key} (${levelId})`);
  }

  return new Float32Array(await response.arrayBuffer());
}

async function loadJson<T>(url: string): Promise<T> {
  const resolvedUrl = resolveGameAssetUrl(url);
  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${resolvedUrl}`);
  }

  return (await response.json()) as T;
}

function resolveGameAssetUrl(path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:')) {
    return path;
  }

  if (BASE_URL === '/' && path.startsWith('/')) {
    return path;
  }

  if (BASE_URL !== '/' && path.startsWith(BASE_URL)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_URL}${normalizedPath}`;
}
