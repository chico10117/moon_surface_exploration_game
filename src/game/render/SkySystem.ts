import * as THREE from 'three';

interface SkySystemOptions {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

interface StarLayerState {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  colorAttribute: THREE.BufferAttribute;
  baseColors: Float32Array;
  directions: Float32Array;
  layerVisibility: number;
}

const SKY_RADIUS = 132_000;
const STAR_FIELD_RADIUS = 124_000;
const SUN_DISC_SCALE = 1_180;
const SUN_HALO_SCALE = 14_400;
const EARTH_DISC_SCALE = 7_200;
const EARTH_GLOW_SCALE = 12_600;
const SUB_EARTH_LATITUDE_DEGREES = 0;
const SUB_EARTH_LONGITUDE_DEGREES = 0;

export class SkySystem {
  private readonly root = new THREE.Group();
  private readonly skyDome: THREE.Mesh;
  private readonly skyDomeMaterial: THREE.ShaderMaterial;
  private readonly starLayers: StarLayerState[] = [];
  private readonly sunDiscTexture = createRadialTexture(256, [
    [0, 'rgba(255, 251, 244, 1)'],
    [0.26, 'rgba(255, 244, 218, 0.98)'],
    [0.48, 'rgba(255, 214, 154, 0.42)'],
    [0.72, 'rgba(255, 198, 128, 0.06)'],
    [1, 'rgba(255, 198, 128, 0)'],
  ]);
  private readonly sunHaloTexture = createRadialTexture(512, [
    [0, 'rgba(255, 243, 217, 0.28)'],
    [0.18, 'rgba(255, 230, 176, 0.18)'],
    [0.42, 'rgba(255, 201, 132, 0.08)'],
    [0.7, 'rgba(255, 183, 116, 0.02)'],
    [1, 'rgba(255, 183, 116, 0)'],
  ]);
  private readonly earthTexture = createEarthDiscTexture();
  private readonly sunDiscMaterial = new THREE.SpriteMaterial({
    map: this.sunDiscTexture,
    color: '#fff8ec',
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly sunHaloMaterial = new THREE.SpriteMaterial({
    map: this.sunHaloTexture,
    color: '#ffd08c',
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly sunDisc = new THREE.Sprite(this.sunDiscMaterial);
  private readonly sunHalo = new THREE.Sprite(this.sunHaloMaterial);
  private readonly earthGlowTexture = createRadialTexture(512, [
    [0, 'rgba(172, 214, 255, 0.32)'],
    [0.24, 'rgba(124, 186, 255, 0.16)'],
    [0.58, 'rgba(88, 138, 220, 0.05)'],
    [1, 'rgba(88, 138, 220, 0)'],
  ]);
  private readonly earthGlowMaterial = new THREE.SpriteMaterial({
    map: this.earthGlowTexture,
    color: '#9bc7ff',
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly earthGlow = new THREE.Sprite(this.earthGlowMaterial);
  private readonly earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uEarthMap: { value: this.earthTexture },
      uSunLocalDirection: { value: new THREE.Vector3(0.24, 0.34, 0.92) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: `
      uniform sampler2D uEarthMap;
      uniform vec3 uSunLocalDirection;

      varying vec2 vUv;

      void main() {
        vec2 discUv = vUv * 2.0 - 1.0;
        float radiusSq = dot( discUv, discUv );
        if ( radiusSq > 1.0 ) {
          discard;
        }

        float sphereZ = sqrt( max( 0.0, 1.0 - radiusSq ) );
        vec3 normal = normalize( vec3( discUv, sphereZ ) );
        vec3 sunDirection = normalize( uSunLocalDirection );
        float illumination = dot( normal, sunDirection );
        float diffuse = smoothstep( -0.16, 0.34, illumination );
        float ambient = 0.2;
        float rim = pow( 1.0 - sphereZ, 2.4 );

        vec3 albedo = texture2D( uEarthMap, vUv ).rgb;
        vec3 atmosphere = vec3( 0.2, 0.36, 0.66 ) * rim * ( 0.28 + diffuse * 0.3 );
        vec3 color = albedo * ( ambient + diffuse * 1.04 ) + atmosphere;
        float alpha = 1.0 - smoothstep( 0.94, 1.0, radiusSq );

        gl_FragColor = vec4( color, alpha );
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly earthDisc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), this.earthMaterial);
  private readonly sunDirection = new THREE.Vector3(0.38, 0.58, -0.72).normalize();
  private readonly earthDirection: THREE.Vector3;
  private readonly tempCameraForward = new THREE.Vector3();
  private readonly tempInverseQuaternion = new THREE.Quaternion();
  private readonly tempSunLocalDirection = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    options: SkySystemOptions,
  ) {
    this.root.name = 'sky-root';

    this.skyDomeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirection: { value: this.sunDirection.clone() },
      },
      vertexShader: `
        varying vec3 vSkyDirection;

        void main() {
          vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
          vSkyDirection = normalize( worldPosition.xyz - cameraPosition );
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDirection;

        varying vec3 vSkyDirection;

        void main() {
          vec3 direction = normalize( vSkyDirection );
          float sunAmount = max( dot( direction, normalize( uSunDirection ) ), 0.0 );
          float coreGlow = pow( sunAmount, 520.0 );
          float wideGlow = pow( sunAmount, 34.0 );

          vec3 color = vec3( 0.0018, 0.0024, 0.0042 );
          color += vec3( 1.0, 0.84, 0.60 ) * wideGlow * 0.028;
          color += vec3( 1.0, 0.95, 0.82 ) * coreGlow * 0.72;

          gl_FragColor = vec4( color, 1.0 );
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });

    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 48, 24),
      this.skyDomeMaterial,
    );
    this.skyDome.frustumCulled = false;
    this.root.add(this.skyDome);

    this.starLayers.push(this.createStarLayer(760, 1.3, 7, 0.86));
    this.starLayers.push(this.createStarLayer(140, 2.6, 19, 1.18));
    for (const layer of this.starLayers) {
      this.root.add(layer.points);
    }

    this.sunDisc.scale.setScalar(SUN_DISC_SCALE);
    this.sunDiscMaterial.depthTest = true;
    this.sunDisc.renderOrder = -30;
    this.root.add(this.sunDisc);

    this.sunHalo.scale.setScalar(SUN_HALO_SCALE);
    this.sunHaloMaterial.depthTest = true;
    this.sunHalo.renderOrder = -32;
    this.root.add(this.sunHalo);

    this.earthDirection = computeEarthDirection(
      options.latitudeDegrees,
      options.longitudeDegrees,
    );

    this.earthDisc.scale.setScalar(EARTH_DISC_SCALE);
    this.earthDisc.position.copy(this.earthDirection).multiplyScalar(SKY_RADIUS * 0.9);
    this.earthDisc.frustumCulled = false;
    this.earthDisc.renderOrder = -28;
    this.root.add(this.earthDisc);

    this.earthGlow.scale.setScalar(EARTH_GLOW_SCALE);
    this.earthGlow.position.copy(this.earthDirection).multiplyScalar(SKY_RADIUS * 0.895);
    this.earthGlow.renderOrder = -29;
    this.root.add(this.earthGlow);

    this.scene.add(this.root);
    this.refreshSunAnchors();
    this.refreshStarVisibility();
  }

  public getInitialViewYawRadians(): number {
    return Math.atan2(this.earthDirection.x, this.earthDirection.z);
  }

  public setSunDirection(direction: THREE.Vector3): void {
    this.sunDirection.copy(direction).normalize();
    (this.skyDomeMaterial.uniforms.uSunDirection.value as THREE.Vector3).copy(this.sunDirection);
    this.refreshSunAnchors();
    this.refreshStarVisibility();
  }

  public update(
    cameraWorldPosition: THREE.Vector3,
    cameraWorldQuaternion: THREE.Quaternion,
  ): void {
    this.root.position.copy(cameraWorldPosition);
    this.earthDisc.quaternion.copy(cameraWorldQuaternion);

    this.tempInverseQuaternion.copy(cameraWorldQuaternion).invert();
    this.tempSunLocalDirection
      .copy(this.sunDirection)
      .applyQuaternion(this.tempInverseQuaternion)
      .normalize();
    (this.earthMaterial.uniforms.uSunLocalDirection.value as THREE.Vector3).copy(
      this.tempSunLocalDirection,
    );

    this.tempCameraForward.set(0, 0, -1).applyQuaternion(cameraWorldQuaternion).normalize();
    const sunViewDot = Math.max(0, this.tempCameraForward.dot(this.sunDirection));
    this.sunHaloMaterial.opacity = 0.03 + Math.pow(sunViewDot, 18) * 0.44;
    this.sunDiscMaterial.opacity = 0.78 + Math.pow(sunViewDot, 7) * 0.18;
  }

  public dispose(): void {
    this.scene.remove(this.root);

    this.skyDome.geometry.dispose();
    this.skyDomeMaterial.dispose();

    for (const layer of this.starLayers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }

    this.sunDiscTexture.dispose();
    this.sunHaloTexture.dispose();
    this.earthTexture.dispose();
    this.earthGlowTexture.dispose();
    this.sunDiscMaterial.dispose();
    this.sunHaloMaterial.dispose();
    this.earthGlowMaterial.dispose();
    this.earthDisc.geometry.dispose();
    this.earthMaterial.dispose();
  }

  private createStarLayer(
    count: number,
    size: number,
    seed: number,
    layerVisibility: number,
  ): StarLayerState {
    const rng = createMulberry32(seed);
    const positions = new Float32Array(count * 3);
    const directions = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const activeColors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let index = 0; index < count; index += 1) {
      const direction = sampleDirection(rng);
      const radius = STAR_FIELD_RADIUS * (0.94 + rng() * 0.06);
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;

      directions[index * 3] = direction.x;
      directions[index * 3 + 1] = direction.y;
      directions[index * 3 + 2] = direction.z;

      const brightness = 0.18 + Math.pow(1 - rng(), 10) * 1.14;
      const colorChoice = rng();
      if (colorChoice < 0.18) {
        color.setRGB(0.76, 0.84, 1.0);
      } else if (colorChoice < 0.34) {
        color.setRGB(1.0, 0.9, 0.76);
      } else {
        color.setRGB(0.95, 0.97, 1.0);
      }

      baseColors[index * 3] = color.r * brightness;
      baseColors[index * 3 + 1] = color.g * brightness;
      baseColors[index * 3 + 2] = color.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colorAttribute = new THREE.BufferAttribute(activeColors, 3);
    geometry.setAttribute('color', colorAttribute);

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      sizeAttenuation: false,
      depthWrite: false,
      toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    return {
      points,
      geometry,
      material,
      colorAttribute,
      baseColors,
      directions,
      layerVisibility,
    };
  }

  private refreshSunAnchors(): void {
    const sunPosition = this.sunDirection.clone().multiplyScalar(SKY_RADIUS * 0.9);
    this.sunDisc.position.copy(sunPosition);
    this.sunHalo.position.copy(sunPosition);
  }

  private refreshStarVisibility(): void {
    const sunElevationVisibility = THREE.MathUtils.lerp(
      0.34,
      0.035,
      THREE.MathUtils.smoothstep(this.sunDirection.y, 0.02, 0.34),
    );

    for (const layer of this.starLayers) {
      for (let index = 0; index < layer.baseColors.length; index += 3) {
        const dot =
          layer.directions[index] * this.sunDirection.x +
          layer.directions[index + 1] * this.sunDirection.y +
          layer.directions[index + 2] * this.sunDirection.z;
        const sunGlareFade = 1 - THREE.MathUtils.smoothstep(dot, 0.72, 0.995);
        const visibility = sunElevationVisibility * layer.layerVisibility * sunGlareFade;

        layer.colorAttribute.array[index] = layer.baseColors[index] * visibility;
        layer.colorAttribute.array[index + 1] = layer.baseColors[index + 1] * visibility;
        layer.colorAttribute.array[index + 2] = layer.baseColors[index + 2] * visibility;
      }

      layer.colorAttribute.needsUpdate = true;
    }
  }
}

function createRadialTexture(
  size: number,
  stops: Array<[number, string]>,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create 2D context for sky texture');
  }

  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createEarthDiscTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create 2D context for Earth texture');
  }

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(size / 2, size / 2);

  const radius = size * 0.43;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.clip();

  const ocean = context.createRadialGradient(-radius * 0.18, -radius * 0.22, radius * 0.1, 0, 0, radius);
  ocean.addColorStop(0, '#7db6ff');
  ocean.addColorStop(0.42, '#3872c6');
  ocean.addColorStop(1, '#18386a');
  context.fillStyle = ocean;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);

  context.globalAlpha = 0.9;
  context.fillStyle = '#6d9862';
  fillBlob(context, [
    [-0.48, -0.04],
    [-0.3, -0.22],
    [-0.08, -0.18],
    [0.08, -0.02],
    [0.04, 0.2],
    [-0.14, 0.14],
    [-0.32, 0.2],
    [-0.46, 0.08],
  ], radius);

  context.fillStyle = '#9ead64';
  fillBlob(context, [
    [0.12, -0.34],
    [0.34, -0.3],
    [0.5, -0.08],
    [0.42, 0.08],
    [0.2, 0.02],
    [0.08, -0.12],
  ], radius);

  context.fillStyle = '#658d5c';
  fillBlob(context, [
    [0.06, 0.12],
    [0.26, 0.08],
    [0.34, 0.24],
    [0.18, 0.42],
    [0.0, 0.34],
    [-0.02, 0.18],
  ], radius);

  context.globalAlpha = 0.42;
  context.strokeStyle = '#ffffff';
  context.lineWidth = radius * 0.06;
  context.lineCap = 'round';
  drawCloudArc(context, -radius * 0.08, -radius * 0.28, radius * 0.54, radius * 0.22, 0.18);
  drawCloudArc(context, radius * 0.08, radius * 0.02, radius * 0.72, radius * 0.18, -0.22);
  drawCloudArc(context, -radius * 0.18, radius * 0.24, radius * 0.46, radius * 0.14, 0.12);

  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fillBlob(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  radius: number,
): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    const px = x * radius;
    const py = y * radius;
    if (index === 0) {
      context.moveTo(px, py);
      return;
    }

    const [prevX, prevY] = points[index - 1];
    const midX = ((prevX + x) / 2) * radius;
    const midY = ((prevY + y) / 2) * radius;
    context.quadraticCurveTo(prevX * radius, prevY * radius, midX, midY);
  });

  const [firstX, firstY] = points[0];
  const [lastX, lastY] = points[points.length - 1];
  context.quadraticCurveTo(lastX * radius, lastY * radius, firstX * radius, firstY * radius);
  context.closePath();
  context.fill();
}

function drawCloudArc(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): void {
  context.beginPath();
  context.ellipse(x, y, width, height, rotation, 0.2, Math.PI - 0.2);
  context.stroke();
}

function computeEarthDirection(
  latitudeDegrees: number,
  longitudeDegrees: number,
): THREE.Vector3 {
  const latitudeRadians = THREE.MathUtils.degToRad(latitudeDegrees);
  const declinationRadians = THREE.MathUtils.degToRad(SUB_EARTH_LATITUDE_DEGREES);
  const hourAngleRadians = THREE.MathUtils.degToRad(
    longitudeDegrees - SUB_EARTH_LONGITUDE_DEGREES,
  );

  const east = -Math.cos(declinationRadians) * Math.sin(hourAngleRadians);
  const north =
    Math.cos(latitudeRadians) * Math.sin(declinationRadians) -
    Math.sin(latitudeRadians) * Math.cos(declinationRadians) * Math.cos(hourAngleRadians);
  const up =
    Math.sin(latitudeRadians) * Math.sin(declinationRadians) +
    Math.cos(latitudeRadians) * Math.cos(declinationRadians) * Math.cos(hourAngleRadians);

  const direction = new THREE.Vector3(east, up, -north);
  if (direction.lengthSq() < 1e-6) {
    return new THREE.Vector3(0.12, 0.78, -0.6);
  }

  return direction.normalize();
}

function sampleDirection(rng: () => number): THREE.Vector3 {
  const theta = rng() * Math.PI * 2;
  const y = rng() * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(
    Math.cos(theta) * radial,
    y,
    Math.sin(theta) * radial,
  );
}

function createMulberry32(seed: number): () => number {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
