import * as THREE from 'three';
import type { SiteManifest, TerrainLodManifest, TerrainLevelManifest, TerrainTileManifest } from '../types';
import { loadColorTexture, loadTileHeights } from './terrainLoader';

interface TileState {
  tile: TerrainTileManifest;
  levelId: string;
  level: TerrainLevelManifest;
  heights: Float32Array;
  mesh: THREE.Mesh;
}

export class TerrainSystem {
  private readonly tileStates = new Map<string, TileState>();
  private readonly levelById = new Map<string, TerrainLevelManifest>();
  private readonly pendingDetailLoads = new Set<string>();
  private readonly material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d7ccb5'),
    roughness: 1,
    metalness: 0,
  });
  private detailTextureLoaded = false;
  private activeTileKey = 'boot';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly site: SiteManifest,
    private readonly manifest: TerrainLodManifest,
  ) {
    for (const level of manifest.levels) {
      this.levelById.set(level.id, level);
    }
  }

  public async initialize(): Promise<void> {
    const lowTexture = await loadColorTexture(this.manifest.textureLow);
    this.material.map = lowTexture;
    this.material.needsUpdate = true;

    await Promise.all(
      this.manifest.tiles.map(async (tile) => {
        const state = await this.createTileState(tile, 'boot');
        this.tileStates.set(tile.key, state);
        this.scene.add(state.mesh);
      }),
    );

    void this.loadDetailTexture();
  }

  public update(playerPosition: THREE.Vector3): void {
    const activeTile = this.getTileForPosition(playerPosition.x, playerPosition.z);
    if (!activeTile) {
      return;
    }

    this.activeTileKey = activeTile.key;
    for (const tile of this.manifest.tiles) {
      const distance = Math.abs(tile.col - activeTile.col) + Math.abs(tile.row - activeTile.row);
      if (distance <= 1) {
        this.ensureDetailTile(tile);
      }
    }
  }

  public getStreamingLabel(): string {
    const loadedDetail = [...this.tileStates.values()].filter((state) => state.levelId === 'detail').length;
    return this.detailTextureLoaded
      ? `${loadedDetail}/${this.manifest.tiles.length} detail tiles`
      : `Boot mesh • ${loadedDetail}/${this.manifest.tiles.length}`;
  }

  public getActiveTileKey(): string {
    return this.activeTileKey;
  }

  public getTileForPosition(x: number, z: number): TerrainTileManifest | null {
    for (const tile of this.manifest.tiles) {
      if (
        x >= tile.boundsMeters.minX &&
        x <= tile.boundsMeters.maxX &&
        z >= tile.boundsMeters.minZ &&
        z <= tile.boundsMeters.maxZ
      ) {
        return tile;
      }
    }

    return null;
  }

  public sampleHeight(x: number, z: number): number {
    const tile = this.getTileForPosition(x, z);
    if (!tile) {
      return this.site.world.meanHeightMeters;
    }

    const state = this.tileStates.get(tile.key);
    if (!state) {
      return this.site.world.meanHeightMeters;
    }

    return sampleHeightFromTile(state, x, z);
  }

  public sampleNormal(x: number, z: number): THREE.Vector3 {
    const tile = this.getTileForPosition(x, z);
    if (!tile) {
      return new THREE.Vector3(0, 1, 0);
    }

    const state = this.tileStates.get(tile.key);
    if (!state) {
      return new THREE.Vector3(0, 1, 0);
    }

    const stepX = (tile.boundsMeters.maxX - tile.boundsMeters.minX) / (state.level.samplesX - 1);
    const stepZ = (tile.boundsMeters.maxZ - tile.boundsMeters.minZ) / (state.level.samplesZ - 1);

    const left = this.sampleHeight(Math.max(tile.boundsMeters.minX, x - stepX), z);
    const right = this.sampleHeight(Math.min(tile.boundsMeters.maxX, x + stepX), z);
    const down = this.sampleHeight(x, Math.max(tile.boundsMeters.minZ, z - stepZ));
    const up = this.sampleHeight(x, Math.min(tile.boundsMeters.maxZ, z + stepZ));

    const dhdx = (right - left) / Math.max(stepX * 2, 1);
    const dhdz = (up - down) / Math.max(stepZ * 2, 1);
    return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
  }

  private async loadDetailTexture(): Promise<void> {
    const texture = await loadColorTexture(this.manifest.textureHigh);
    this.material.map = texture;
    this.material.needsUpdate = true;
    this.detailTextureLoaded = true;
  }

  private ensureDetailTile(tile: TerrainTileManifest): void {
    const existing = this.tileStates.get(tile.key);
    if (!existing || existing.levelId === 'detail' || this.pendingDetailLoads.has(tile.key)) {
      return;
    }

    this.pendingDetailLoads.add(tile.key);
    void this.replaceWithDetail(tile);
  }

  private async replaceWithDetail(tile: TerrainTileManifest): Promise<void> {
    try {
      const nextState = await this.createTileState(tile, 'detail');
      const previous = this.tileStates.get(tile.key);
      if (previous) {
        this.scene.remove(previous.mesh);
        previous.mesh.geometry.dispose();
      }

      this.tileStates.set(tile.key, nextState);
      this.scene.add(nextState.mesh);
    } finally {
      this.pendingDetailLoads.delete(tile.key);
    }
  }

  private async createTileState(tile: TerrainTileManifest, levelId: string): Promise<TileState> {
    const level = this.levelById.get(levelId);
    if (!level) {
      throw new Error(`Unknown terrain level ${levelId}`);
    }

    const heights = await loadTileHeights(tile, levelId);
    const geometry = buildTileGeometry(tile, level, heights);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    return { tile, levelId, level, heights, mesh };
  }
}

function buildTileGeometry(
  tile: TerrainTileManifest,
  level: TerrainLevelManifest,
  heights: Float32Array,
): THREE.BufferGeometry {
  const { samplesX, samplesZ } = level;
  const vertexCount = samplesX * samplesZ;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indexCount = (samplesX - 1) * (samplesZ - 1) * 6;
  const indices = new Uint32Array(indexCount);

  const width = tile.boundsMeters.maxX - tile.boundsMeters.minX;
  const depth = tile.boundsMeters.maxZ - tile.boundsMeters.minZ;

  let pointer = 0;
  let uvPointer = 0;
  for (let row = 0; row < samplesZ; row += 1) {
    const v = row / (samplesZ - 1);
    const z = tile.boundsMeters.minZ + depth * v;
    for (let col = 0; col < samplesX; col += 1) {
      const u = col / (samplesX - 1);
      const x = tile.boundsMeters.minX + width * u;
      const height = heights[row * samplesX + col];

      positions[pointer] = x;
      positions[pointer + 1] = height;
      positions[pointer + 2] = z;
      pointer += 3;

      uvs[uvPointer] = THREE.MathUtils.lerp(tile.uvBounds.u0, tile.uvBounds.u1, u);
      uvs[uvPointer + 1] = THREE.MathUtils.lerp(tile.uvBounds.v0, tile.uvBounds.v1, v);
      uvPointer += 2;
    }
  }

  let indexPointer = 0;
  for (let row = 0; row < samplesZ - 1; row += 1) {
    for (let col = 0; col < samplesX - 1; col += 1) {
      const topLeft = row * samplesX + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + samplesX;
      const bottomRight = bottomLeft + 1;

      indices[indexPointer] = topLeft;
      indices[indexPointer + 1] = bottomLeft;
      indices[indexPointer + 2] = topRight;
      indices[indexPointer + 3] = topRight;
      indices[indexPointer + 4] = bottomLeft;
      indices[indexPointer + 5] = bottomRight;
      indexPointer += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sampleHeightFromTile(state: TileState, x: number, z: number): number {
  const { tile, level, heights } = state;
  const width = tile.boundsMeters.maxX - tile.boundsMeters.minX;
  const depth = tile.boundsMeters.maxZ - tile.boundsMeters.minZ;

  const u = THREE.MathUtils.clamp((x - tile.boundsMeters.minX) / width, 0, 1) * (level.samplesX - 1);
  const v = THREE.MathUtils.clamp((z - tile.boundsMeters.minZ) / depth, 0, 1) * (level.samplesZ - 1);

  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const x1 = Math.min(level.samplesX - 1, x0 + 1);
  const z1 = Math.min(level.samplesZ - 1, z0 + 1);
  const tx = u - x0;
  const tz = v - z0;

  const h00 = heights[z0 * level.samplesX + x0];
  const h10 = heights[z0 * level.samplesX + x1];
  const h01 = heights[z1 * level.samplesX + x0];
  const h11 = heights[z1 * level.samplesX + x1];
  const h0 = THREE.MathUtils.lerp(h00, h10, tx);
  const h1 = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(h0, h1, tz);
}
