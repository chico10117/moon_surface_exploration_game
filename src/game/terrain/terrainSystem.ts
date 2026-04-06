import * as THREE from 'three';
import type { SiteManifest, TerrainLodManifest, TerrainLevelManifest, TerrainTileManifest } from '../types';
import {
  loadColorTexture,
  loadLinearTexture,
  loadRepeatingColorTexture,
  loadRepeatingLinearTexture,
  loadTileHeights,
} from './terrainLoader';

interface TileState {
  tile: TerrainTileManifest;
  levelId: string;
  level: TerrainLevelManifest;
  heights: Float32Array;
  mesh: THREE.Mesh;
  material: TerrainMaterial;
}

interface SurfaceMaps {
  albedo: THREE.Texture;
  macroNormal: THREE.Texture;
  macroOcclusion: THREE.Texture;
  detailAlbedo: THREE.Texture;
  detailNormal: THREE.Texture;
}

interface TransitionState {
  from: TileState;
  to: TileState;
  elapsedSeconds: number;
  durationSeconds: number;
}

interface TerrainUniformSet {
  macroNormalMap: { value: THREE.Texture };
  macroOcclusionMap: { value: THREE.Texture };
  detailAlbedoMap: { value: THREE.Texture };
  detailNormalMap: { value: THREE.Texture };
  macroNormalStrength: { value: number };
  occlusionStrength: { value: number };
  detailAlbedoStrength: { value: number };
  detailNormalStrength: { value: number };
  detailNearRepeat: { value: number };
  detailFarRepeat: { value: number };
  triplanarBlendSharpness: { value: number };
}

type TerrainMaterial = THREE.MeshStandardMaterial & {
  userData: {
    terrainUniforms?: TerrainUniformSet;
  };
};

const DEFAULT_MATERIAL_TUNING = {
  macroNormalStrength: 0.58,
  occlusionStrength: 0.12,
  detailAlbedoStrength: 0.12,
  detailNormalStrength: 0.16,
  detailNearRepeat: 0.085,
  detailFarRepeat: 0.022,
  triplanarBlendSharpness: 5.2,
};

const TILE_TRANSITION_SECONDS = 0.35;

export class TerrainSystem {
  private readonly tileStates = new Map<string, TileState>();
  private readonly transitionStates = new Map<string, TransitionState>();
  private readonly levelById = new Map<string, TerrainLevelManifest>();
  private readonly pendingDetailLoads = new Map<string, Promise<void>>();
  private readonly materials = new Set<TerrainMaterial>();
  private readonly tuning: typeof DEFAULT_MATERIAL_TUNING;
  private surfaceMaps: SurfaceMaps | null = null;
  private highSurfaceLoaded = false;
  private highSurfacePromise: Promise<void> | null = null;
  private activeTileKey = 'boot';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly site: SiteManifest,
    private readonly manifest: TerrainLodManifest,
  ) {
    this.tuning = {
      ...DEFAULT_MATERIAL_TUNING,
      ...manifest.materialTuning,
    };
    for (const level of manifest.levels) {
      this.levelById.set(level.id, level);
    }
  }

  public async initialize(): Promise<void> {
    this.surfaceMaps = await this.loadBootSurfaceMaps();

    await Promise.all(
      this.manifest.tiles.map(async (tile) => {
        const state = await this.createTileState(tile, 'boot');
        this.tileStates.set(tile.key, state);
        this.scene.add(state.mesh);
      }),
    );

    void this.loadHighSurfaceTextures();
  }

  public async warmStart(playerPosition: THREE.Vector3, preloadRadius = 1): Promise<void> {
    await Promise.all([
      this.loadHighSurfaceTextures(),
      this.preloadDetailAroundPosition(playerPosition, preloadRadius),
    ]);
    this.updateTransitions(TILE_TRANSITION_SECONDS);
  }

  public update(playerPosition: THREE.Vector3, deltaSeconds: number, preloadRadius = 1): void {
    const activeTile = this.getTileForPosition(playerPosition.x, playerPosition.z);
    if (activeTile) {
      this.activeTileKey = activeTile.key;
      for (const tile of this.manifest.tiles) {
        const distance = Math.abs(tile.col - activeTile.col) + Math.abs(tile.row - activeTile.row);
        if (distance <= preloadRadius) {
          void this.ensureDetailTile(tile);
        }
      }
    }

    this.updateTransitions(deltaSeconds);
  }

  public getStreamingLabel(): string {
    const loadedDetail = [...this.tileStates.values()].filter((state) => state.levelId === 'detail').length;
    return this.highSurfaceLoaded
      ? `${loadedDetail}/${this.manifest.tiles.length} detail tiles`
      : `Boot surface • ${loadedDetail}/${this.manifest.tiles.length}`;
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

  private async preloadDetailAroundPosition(
    playerPosition: THREE.Vector3,
    preloadRadius: number,
  ): Promise<void> {
    const activeTile = this.getTileForPosition(playerPosition.x, playerPosition.z);
    if (!activeTile) {
      return;
    }

    const loads = this.manifest.tiles
      .filter(
        (tile) =>
          Math.abs(tile.col - activeTile.col) + Math.abs(tile.row - activeTile.row) <= preloadRadius,
      )
      .map((tile) => this.ensureDetailTile(tile));

    await Promise.all(loads);
  }

  private async loadBootSurfaceMaps(): Promise<SurfaceMaps> {
    const [albedo, macroNormal, macroOcclusion, detailAlbedo, detailNormal] = await Promise.all([
      loadColorTexture(this.manifest.albedoLow),
      loadLinearTexture(this.manifest.macroNormalLow),
      loadLinearTexture(this.manifest.macroOcclusionLow),
      loadRepeatingColorTexture(this.manifest.detailAlbedo),
      loadRepeatingLinearTexture(this.manifest.detailNormal),
    ]);

    return {
      albedo,
      macroNormal,
      macroOcclusion,
      detailAlbedo,
      detailNormal,
    };
  }

  private async loadHighSurfaceTextures(): Promise<void> {
    if (this.highSurfaceLoaded) {
      return;
    }

    if (this.highSurfacePromise) {
      await this.highSurfacePromise;
      return;
    }

    this.highSurfacePromise = (async () => {
      try {
        const [albedo, macroNormal, macroOcclusion] = await Promise.all([
          loadColorTexture(this.manifest.albedoHigh),
          loadLinearTexture(this.manifest.macroNormalHigh),
          loadLinearTexture(this.manifest.macroOcclusionHigh),
        ]);

        if (!this.surfaceMaps) {
          return;
        }

        this.surfaceMaps = {
          ...this.surfaceMaps,
          albedo,
          macroNormal,
          macroOcclusion,
        };
        this.highSurfaceLoaded = true;
        this.applySurfaceMapsToAllMaterials();
      } catch (error) {
        console.warn('Unable to load high-detail terrain surface maps:', error);
      } finally {
        this.highSurfacePromise = null;
      }
    })();

    await this.highSurfacePromise;
  }

  private applySurfaceMapsToAllMaterials(): void {
    for (const material of this.materials) {
      this.applySurfaceMapsToMaterial(material);
    }
  }

  private createMaterial(): TerrainMaterial {
    if (!this.surfaceMaps) {
      throw new Error('Terrain surface maps must be loaded before creating materials');
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffffff'),
      roughness: 0.985,
      metalness: 0,
    }) as TerrainMaterial;

    material.userData.terrainUniforms = {
      macroNormalMap: { value: this.surfaceMaps.macroNormal },
      macroOcclusionMap: { value: this.surfaceMaps.macroOcclusion },
      detailAlbedoMap: { value: this.surfaceMaps.detailAlbedo },
      detailNormalMap: { value: this.surfaceMaps.detailNormal },
      macroNormalStrength: { value: this.tuning.macroNormalStrength },
      occlusionStrength: { value: this.tuning.occlusionStrength },
      detailAlbedoStrength: { value: this.tuning.detailAlbedoStrength },
      detailNormalStrength: { value: this.tuning.detailNormalStrength },
      detailNearRepeat: { value: this.tuning.detailNearRepeat },
      detailFarRepeat: { value: this.tuning.detailFarRepeat },
      triplanarBlendSharpness: { value: this.tuning.triplanarBlendSharpness },
    };

    material.onBeforeCompile = (shader) => {
      const uniforms = material.userData.terrainUniforms!;
      shader.uniforms.macroNormalMap = uniforms.macroNormalMap;
      shader.uniforms.macroOcclusionMap = uniforms.macroOcclusionMap;
      shader.uniforms.detailAlbedoMap = uniforms.detailAlbedoMap;
      shader.uniforms.detailNormalMap = uniforms.detailNormalMap;
      shader.uniforms.macroNormalStrength = uniforms.macroNormalStrength;
      shader.uniforms.occlusionStrength = uniforms.occlusionStrength;
      shader.uniforms.detailAlbedoStrength = uniforms.detailAlbedoStrength;
      shader.uniforms.detailNormalStrength = uniforms.detailNormalStrength;
      shader.uniforms.detailNearRepeat = uniforms.detailNearRepeat;
      shader.uniforms.detailFarRepeat = uniforms.detailFarRepeat;
      shader.uniforms.triplanarBlendSharpness = uniforms.triplanarBlendSharpness;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTerrainWorldPosition;
varying vec3 vTerrainWorldNormal;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vTerrainWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTerrainWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_pars_fragment>',
          `#include <map_pars_fragment>
varying vec3 vTerrainWorldPosition;
varying vec3 vTerrainWorldNormal;
uniform sampler2D macroNormalMap;
uniform sampler2D macroOcclusionMap;
uniform sampler2D detailAlbedoMap;
uniform sampler2D detailNormalMap;
uniform float macroNormalStrength;
uniform float occlusionStrength;
uniform float detailAlbedoStrength;
uniform float detailNormalStrength;
uniform float detailNearRepeat;
uniform float detailFarRepeat;
uniform float triplanarBlendSharpness;

vec3 decodeSurfaceNormal( vec3 encodedNormal ) {
  return normalize( encodedNormal * 2.0 - 1.0 );
}

vec3 triplanarBlendWeights( vec3 worldNormal, float sharpness ) {
  vec3 weights = pow( abs( normalize( worldNormal ) ) + vec3( 1e-4 ), vec3( sharpness ) );
  return weights / max( weights.x + weights.y + weights.z, 1e-5 );
}

vec4 sampleTriplanarColor( sampler2D tex, vec3 worldPosition, vec3 weights, float repeatScale ) {
  vec4 xSample = texture2D( tex, worldPosition.zy * repeatScale );
  vec4 ySample = texture2D( tex, worldPosition.xz * repeatScale );
  vec4 zSample = texture2D( tex, worldPosition.xy * repeatScale );
  return xSample * weights.x + ySample * weights.y + zSample * weights.z;
}

vec3 sampleTriplanarNormal( sampler2D tex, vec3 worldPosition, vec3 worldNormal, float repeatScale, float sharpness ) {
  vec3 weights = triplanarBlendWeights( worldNormal, sharpness );
  float signX = worldNormal.x < 0.0 ? -1.0 : 1.0;
  float signY = worldNormal.y < 0.0 ? -1.0 : 1.0;
  float signZ = worldNormal.z < 0.0 ? -1.0 : 1.0;

  vec3 xNormal = decodeSurfaceNormal( texture2D( tex, worldPosition.zy * repeatScale ).xyz );
  vec3 yNormal = decodeSurfaceNormal( texture2D( tex, worldPosition.xz * repeatScale ).xyz );
  vec3 zNormal = decodeSurfaceNormal( texture2D( tex, worldPosition.xy * repeatScale ).xyz );

  vec3 worldFromX = normalize( vec3( xNormal.z * signX, xNormal.y, xNormal.x * signX ) );
  vec3 worldFromY = normalize( vec3( yNormal.x, yNormal.z * signY, yNormal.y * signY ) );
  vec3 worldFromZ = normalize( vec3( zNormal.x, zNormal.y, zNormal.z * signZ ) );

  return normalize( worldFromX * weights.x + worldFromY * weights.y + worldFromZ * weights.z );
}`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
float macroOcclusion = texture2D( macroOcclusionMap, vMapUv ).r;
vec3 detailWeights = triplanarBlendWeights( vTerrainWorldNormal, triplanarBlendSharpness );
vec3 detailNearColor = sampleTriplanarColor( detailAlbedoMap, vTerrainWorldPosition, detailWeights, detailNearRepeat ).rgb;
vec3 detailFarColor = sampleTriplanarColor( detailAlbedoMap, vTerrainWorldPosition + vec3( 123.0, 0.0, 71.0 ), detailWeights, detailFarRepeat ).rgb;
vec3 detailColor = mix( detailFarColor, detailNearColor, 0.72 ) * 2.0;
diffuseColor.rgb *= mix( vec3( 1.0 ), detailColor, detailAlbedoStrength );
diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( macroOcclusion ), occlusionStrength );`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
vec3 terrainBaseWorldNormal = normalize( vTerrainWorldNormal );
vec3 macroWorldNormal = normalize( mix(
  terrainBaseWorldNormal,
  decodeSurfaceNormal( texture2D( macroNormalMap, vMapUv ).xyz ),
  macroNormalStrength
) );
vec3 detailNearWorldNormal = sampleTriplanarNormal(
  detailNormalMap,
  vTerrainWorldPosition,
  macroWorldNormal,
  detailNearRepeat,
  triplanarBlendSharpness
);
vec3 detailFarWorldNormal = sampleTriplanarNormal(
  detailNormalMap,
  vTerrainWorldPosition + vec3( 123.0, 0.0, 71.0 ),
  macroWorldNormal,
  detailFarRepeat,
  triplanarBlendSharpness
);
vec3 terrainWorldNormal = normalize( mix(
  macroWorldNormal,
  normalize( mix( detailFarWorldNormal, detailNearWorldNormal, 0.72 ) ),
  detailNormalStrength
) );
normal = normalize( ( viewMatrix * vec4( terrainWorldNormal, 0.0 ) ).xyz );`,
        );
    };
    material.customProgramCacheKey = () => 'tycho-terrain-surface-v4';

    this.applySurfaceMapsToMaterial(material);
    this.materials.add(material);
    return material;
  }

  private applySurfaceMapsToMaterial(material: TerrainMaterial): void {
    if (!this.surfaceMaps) {
      return;
    }

    material.map = this.surfaceMaps.albedo;
    const uniforms = material.userData.terrainUniforms;
    if (uniforms) {
      uniforms.macroNormalMap.value = this.surfaceMaps.macroNormal;
      uniforms.macroOcclusionMap.value = this.surfaceMaps.macroOcclusion;
      uniforms.detailAlbedoMap.value = this.surfaceMaps.detailAlbedo;
      uniforms.detailNormalMap.value = this.surfaceMaps.detailNormal;
    }
    material.needsUpdate = true;
  }

  private async ensureDetailTile(tile: TerrainTileManifest): Promise<void> {
    const existing = this.tileStates.get(tile.key);
    if (!existing || existing.levelId === 'detail') {
      return;
    }

    const pending = this.pendingDetailLoads.get(tile.key);
    if (pending) {
      await pending;
      return;
    }

    const load = this.replaceWithDetail(tile).finally(() => {
      this.pendingDetailLoads.delete(tile.key);
    });
    this.pendingDetailLoads.set(tile.key, load);
    await load;
  }

  private async replaceWithDetail(tile: TerrainTileManifest): Promise<void> {
    const previous = this.tileStates.get(tile.key);
    if (!previous || previous.levelId === 'detail') {
      return;
    }

    const nextState = await this.createTileState(tile, 'detail');
    syncMaterialOpacity(nextState.material, 0, true, true);
    nextState.mesh.renderOrder = previous.mesh.renderOrder + 1;
    this.scene.add(nextState.mesh);
    this.tileStates.set(tile.key, nextState);
    this.transitionStates.set(tile.key, {
      from: previous,
      to: nextState,
      elapsedSeconds: 0,
      durationSeconds: TILE_TRANSITION_SECONDS,
    });
  }

  private updateTransitions(deltaSeconds: number): void {
    for (const [tileKey, transition] of this.transitionStates) {
      transition.elapsedSeconds = Math.min(
        transition.durationSeconds,
        transition.elapsedSeconds + deltaSeconds,
      );

      const progress = smoothstep(transition.elapsedSeconds / transition.durationSeconds);
      syncMaterialOpacity(transition.from.material, 1 - progress, true, false);
      syncMaterialOpacity(transition.to.material, progress, true, true);

      if (progress >= 1) {
        syncMaterialOpacity(transition.to.material, 1, false, false);
        this.scene.remove(transition.from.mesh);
        disposeTileState(transition.from, this.materials);
        this.transitionStates.delete(tileKey);
      }
    }
  }

  private async createTileState(tile: TerrainTileManifest, levelId: string): Promise<TileState> {
    const level = this.levelById.get(levelId);
    if (!level) {
      throw new Error(`Unknown terrain level ${levelId}`);
    }

    const heights = await loadTileHeights(tile, levelId);
    const geometry = buildTileGeometry(tile, level, heights);
    const material = this.createMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    return { tile, levelId, level, heights, mesh, material };
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

function syncMaterialOpacity(
  material: TerrainMaterial,
  opacity: number,
  transitioning: boolean,
  layered: boolean,
): void {
  const transparentChanged = material.transparent !== transitioning;
  const depthWriteChanged = material.depthWrite !== !transitioning;
  const polygonOffsetChanged = material.polygonOffset !== (transitioning && layered);
  const polygonFactorChanged = material.polygonOffsetFactor !== (layered ? -1 : 0);
  const polygonUnitsChanged = material.polygonOffsetUnits !== (layered ? -1 : 0);
  material.opacity = opacity;
  material.transparent = transitioning;
  material.depthWrite = !transitioning;
  material.polygonOffset = transitioning && layered;
  material.polygonOffsetFactor = layered ? -1 : 0;
  material.polygonOffsetUnits = layered ? -1 : 0;
  if (
    transparentChanged ||
    depthWriteChanged ||
    polygonOffsetChanged ||
    polygonFactorChanged ||
    polygonUnitsChanged
  ) {
    material.needsUpdate = true;
  }
}

function disposeTileState(state: TileState, materials: Set<TerrainMaterial>): void {
  state.mesh.geometry.dispose();
  state.material.dispose();
  materials.delete(state.material);
}

function smoothstep(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
