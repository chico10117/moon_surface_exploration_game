export interface SiteManifest {
  id: string;
  title: string;
  description: string;
  boundsDegrees: {
    lonMin: number;
    lonMax: number;
    latMin: number;
    latMax: number;
  };
  world: {
    widthMeters: number;
    heightMeters: number;
    minHeightMeters: number;
    maxHeightMeters: number;
    meanHeightMeters: number;
    widthSamples: number;
    heightSamples: number;
    metersPerSampleX: number;
    metersPerSampleZ: number;
  };
  grid: {
    rows: number;
    cols: number;
  };
  spawn: {
    x: number;
    y: number;
    z: number;
    headingDegrees: number;
  };
  source: {
    dataset: string;
    citation: string;
    sourceUrl: string;
  };
  sunPresets: Record<
    string,
    {
      azimuthDegrees: number;
      elevationDegrees: number;
    }
  >;
}

export interface TerrainTileBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainTileManifest {
  key: string;
  row: number;
  col: number;
  boundsMeters: TerrainTileBounds;
  uvBounds: {
    u0: number;
    u1: number;
    v0: number;
    v1: number;
  };
  files: Record<string, string>;
}

export interface TerrainLevelManifest {
  id: string;
  samplesX: number;
  samplesZ: number;
}

export interface TerrainLodManifest {
  textureLow: string;
  textureHigh: string;
  detailOverlay?: {
    texture: string;
    repeat: number;
    strength: number;
  };
  levels: TerrainLevelManifest[];
  tiles: TerrainTileManifest[];
}

export interface MissionObjective {
  id: string;
  label: string;
  note: string;
  x: number;
  y: number;
  z: number;
  radiusMeters: number;
  scanDurationSeconds: number;
}

export interface MissionManifest {
  title: string;
  briefing: string;
  objectives: MissionObjective[];
  returnZone: MissionObjective;
}

export interface LoadedSiteData {
  site: SiteManifest;
  terrain: TerrainLodManifest;
  mission: MissionManifest;
}

export interface RoverTelemetry {
  speedMps: number;
  slopeDegrees: number;
  batteryPercent: number;
  activeTileKey: string;
  streamingLabel: string;
  statusLabel: string;
  statusTone: 'default' | 'stable' | 'warning';
  actionPrompt: string;
}
