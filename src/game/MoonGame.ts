import * as THREE from 'three';
import type { HudBindings } from './ui/hud';
import { HudController } from './ui/hud';
import { InputController } from './systems/input';
import { MissionController } from './systems/mission';
import { loadSiteData } from './terrain/terrainLoader';
import { TerrainSystem } from './terrain/terrainSystem';
import type { LoadedSiteData, RoverTelemetry } from './types';

interface MarkerState {
  id: string;
  group: THREE.Group;
  baseY: number;
}

const ROVER_DIMENSIONS = {
  bodyWidth: 2.6,
  bodyHeight: 0.78,
  bodyLength: 3.6,
  bodyY: 0.92,
  mastWidth: 0.16,
  mastHeight: 0.82,
  mastDepth: 0.16,
  mastY: 1.52,
  mastZ: 0.32,
  headWidth: 0.62,
  headHeight: 0.24,
  headDepth: 0.42,
  headY: 1.96,
  headZ: 0.34,
  wheelRadius: 0.46,
  wheelThickness: 0.24,
  wheelX: 1.08,
  wheelY: 0.46,
  wheelZFront: 1.18,
  wheelZMid: 0,
  wheelZRear: -1.18,
  rideHeight: 0.62,
  cameraTargetHeight: 1.75,
  cameraDistance: 34,
};

export class MoonGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400000);
  private readonly clock = new THREE.Clock();
  private readonly input = new InputController();
  private readonly hud: HudController;
  private readonly rover = new THREE.Group();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraBack = new THREE.Vector3();
  private readonly roverPosition = new THREE.Vector3();
  private readonly roverUp = new THREE.Vector3(0, 1, 0);
  private readonly roverForward = new THREE.Vector3(0, 0, 1);
  private readonly markerStates = new Map<string, MarkerState>();

  private siteData: LoadedSiteData | null = null;
  private terrainSystem: TerrainSystem | null = null;
  private missionController: MissionController | null = null;

  private headingRadians = 0;
  private speedMps = 0;
  private batteryPercent = 100;
  private cameraOrbitYawRadians = THREE.MathUtils.degToRad(18);
  private cameraOrbitPitchRadians = 0.42;
  private isDraggingCamera = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    bindings: HudBindings,
  ) {
    this.hud = new HudController(bindings);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#03050a');
    this.scene.fog = new THREE.Fog('#05080d', 90000, 240000);

    this.setupSceneScaffold();
    this.setupRover();
    this.setupCameraControls(canvas);
    window.addEventListener('resize', this.handleResize);
  }

  public async start(): Promise<void> {
    this.handleResize();

    const siteData = await loadSiteData();
    this.siteData = siteData;

    const terrainSystem = new TerrainSystem(this.scene, siteData.site, siteData.terrain);
    await terrainSystem.initialize();
    this.terrainSystem = terrainSystem;

    const missionController = new MissionController(siteData.mission);
    this.missionController = missionController;
    this.hud.setMission(siteData.mission);
    this.resetRun();

    this.clock.start();
    this.animate();
  }

  private readonly handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  private setupSceneScaffold(): void {
    const ambient = new THREE.HemisphereLight('#b6c9db', '#0c1017', 0.42);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight('#ffe2b0', 2.7);
    sun.position.set(-28000, 56000, -22000);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.near = 500;
    sun.shadow.camera.far = 120000;
    sun.shadow.camera.left = -30000;
    sun.shadow.camera.right = 30000;
    sun.shadow.camera.top = 30000;
    sun.shadow.camera.bottom = -30000;
    this.scene.add(sun);

    const dustLight = new THREE.DirectionalLight('#6ba7d8', 0.4);
    dustLight.position.set(48000, 12000, 32000);
    this.scene.add(dustLight);

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index += 1) {
      const radius = 170000 + Math.random() * 90000;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index * 3 + 1] = radius * Math.cos(phi);
      starPositions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));

    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: '#dfe9ff', size: 110, sizeAttenuation: true }),
    );
    this.scene.add(stars);
  }

  private setupCameraControls(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      this.isDraggingCamera = true;
      this.activePointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.isDraggingCamera || event.pointerId !== this.activePointerId) {
        return;
      }

      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.cameraOrbitYawRadians += deltaX * 0.0055;
      this.cameraOrbitPitchRadians = THREE.MathUtils.clamp(
        this.cameraOrbitPitchRadians + deltaY * 0.0032,
        0.14,
        1.18,
      );
    });

    const releasePointer = (event: PointerEvent): void => {
      if (event.pointerId !== this.activePointerId) {
        return;
      }

      this.isDraggingCamera = false;
      this.activePointerId = null;
    };

    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('lostpointercapture', () => {
      this.isDraggingCamera = false;
      this.activePointerId = null;
    });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
  }

  private setupRover(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: '#f0b96f',
      roughness: 0.85,
      metalness: 0.08,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: '#5fd0df',
      emissive: '#267f9c',
      emissiveIntensity: 0.4,
      roughness: 0.45,
    });
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: '#2f343c',
      roughness: 1,
      metalness: 0.04,
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.bodyWidth,
        ROVER_DIMENSIONS.bodyHeight,
        ROVER_DIMENSIONS.bodyLength,
      ),
      bodyMaterial,
    );
    body.position.y = ROVER_DIMENSIONS.bodyY;
    body.castShadow = true;
    this.rover.add(body);

    const mast = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.mastWidth,
        ROVER_DIMENSIONS.mastHeight,
        ROVER_DIMENSIONS.mastDepth,
      ),
      trimMaterial,
    );
    mast.position.set(0, ROVER_DIMENSIONS.mastY, ROVER_DIMENSIONS.mastZ);
    mast.castShadow = true;
    this.rover.add(mast);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.headWidth,
        ROVER_DIMENSIONS.headHeight,
        ROVER_DIMENSIONS.headDepth,
      ),
      trimMaterial,
    );
    head.position.set(0, ROVER_DIMENSIONS.headY, ROVER_DIMENSIONS.headZ);
    head.castShadow = true;
    this.rover.add(head);

    const wheelGeometry = new THREE.CylinderGeometry(
      ROVER_DIMENSIONS.wheelRadius,
      ROVER_DIMENSIONS.wheelRadius,
      ROVER_DIMENSIONS.wheelThickness,
      20,
    );
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelOffsets = [
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZFront],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZFront],
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZMid],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZMid],
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZRear],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZRear],
    ];

    for (const [x, y, z] of wheelOffsets) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(x, y, z);
      wheel.castShadow = true;
      this.rover.add(wheel);
    }

    this.scene.add(this.rover);
  }

  private resetRun(): void {
    if (!this.siteData || !this.terrainSystem || !this.missionController) {
      return;
    }

    this.headingRadians = THREE.MathUtils.degToRad(this.siteData.site.spawn.headingDegrees);
    this.speedMps = 0;
    this.batteryPercent = 100;
    this.missionController.reset();

    const spawn = this.siteData.site.spawn;
    const terrainHeight = this.terrainSystem.sampleHeight(spawn.x, spawn.z);
    this.roverPosition.set(spawn.x, terrainHeight + ROVER_DIMENSIONS.rideHeight, spawn.z);
    this.rebuildMarkers();
    this.updateRoverTransform();
  }

  private rebuildMarkers(): void {
    if (!this.siteData || !this.terrainSystem) {
      return;
    }

    for (const marker of this.markerStates.values()) {
      this.scene.remove(marker.group);
    }
    this.markerStates.clear();

    for (const objective of this.siteData.mission.objectives) {
      const marker = createMarker('#8eddf1');
      const baseY = this.terrainSystem.sampleHeight(objective.x, objective.z) + 1500;
      marker.position.set(objective.x, baseY, objective.z);
      this.scene.add(marker);
      this.markerStates.set(objective.id, { id: objective.id, group: marker, baseY });
    }

    const returnMarker = createMarker('#ffc26f');
    const returnZone = this.siteData.mission.returnZone;
    const baseY = this.terrainSystem.sampleHeight(returnZone.x, returnZone.z) + 1700;
    returnMarker.position.set(returnZone.x, baseY, returnZone.z);
    this.scene.add(returnMarker);
    this.markerStates.set(returnZone.id, { id: returnZone.id, group: returnMarker, baseY });
  }

  private animate = (): void => {
    window.requestAnimationFrame(this.animate);

    const deltaSeconds = Math.min(0.05, this.clock.getDelta());
    this.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  };

  private update(deltaSeconds: number): void {
    if (!this.siteData || !this.terrainSystem || !this.missionController) {
      return;
    }

    if (this.input.isPressed('KeyR')) {
      this.resetRun();
    }

    this.terrainSystem.update(this.roverPosition);

    const throttleInput = this.input.getAxis('KeyS', 'KeyW');
    const steerInput = this.input.getAxis('KeyD', 'KeyA');
    const boost = this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');
    const braking = this.input.isPressed('Space');
    const scanHeld = this.input.isPressed('KeyE');

    const surfaceNormal = this.terrainSystem.sampleNormal(this.roverPosition.x, this.roverPosition.z);
    const slopeDegrees = THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(surfaceNormal.y, -1, 1)),
    );
    const forwardOnPlane = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .normalize();
    const uphillFactor = surfaceNormal.dot(forwardOnPlane);

    const maxSpeed = boost ? 340 : 220;
    const acceleration = boost ? 90 : 55;
    const drag = braking ? 0.12 : 0.028;
    const slopePenalty = THREE.MathUtils.clamp((slopeDegrees - 8) / 24, 0, 0.8);
    const grip = 1 - slopePenalty * 0.7;

    this.headingRadians -=
      steerInput *
      deltaSeconds *
      THREE.MathUtils.lerp(0.9, 0.3, Math.min(1, Math.abs(this.speedMps) / 240));
    this.speedMps += throttleInput * acceleration * grip * deltaSeconds;
    this.speedMps -= uphillFactor * 30 * deltaSeconds;
    this.speedMps -= this.speedMps * drag;
    this.speedMps = THREE.MathUtils.clamp(
      this.speedMps,
      -55,
      maxSpeed * Math.max(0.22, this.batteryPercent / 100),
    );

    const movement = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .multiplyScalar(this.speedMps * deltaSeconds);
    this.roverPosition.x += movement.x;
    this.roverPosition.z += movement.z;

    const world = this.siteData.site.world;
    this.roverPosition.x = THREE.MathUtils.clamp(
      this.roverPosition.x,
      -world.widthMeters * 0.48,
      world.widthMeters * 0.48,
    );
    this.roverPosition.z = THREE.MathUtils.clamp(
      this.roverPosition.z,
      -world.heightMeters * 0.48,
      world.heightMeters * 0.48,
    );

    const height = this.terrainSystem.sampleHeight(this.roverPosition.x, this.roverPosition.z);
    this.roverPosition.y = height + ROVER_DIMENSIONS.rideHeight;

    this.updateBattery(deltaSeconds, throttleInput, scanHeld);
    this.updateRoverTransform();
    this.updateCamera(deltaSeconds);
    this.animateMarkers(deltaSeconds);

    const mission = this.missionController.update({
      roverPosition: this.roverPosition,
      roverSpeedMps: Math.abs(this.speedMps),
      scanHeld,
      deltaSeconds,
    });

    this.hud.updateObjectives(
      mission.activeObjective?.id ?? null,
      mission.completedObjectiveIds,
      mission.returnUnlocked,
    );

    const telemetry: RoverTelemetry = {
      speedMps: Math.abs(this.speedMps),
      slopeDegrees,
      batteryPercent: this.batteryPercent,
      activeTileKey: this.terrainSystem.getActiveTileKey(),
      streamingLabel: this.terrainSystem.getStreamingLabel(),
      statusLabel: this.batteryPercent < 18 ? 'Low solar reserve' : mission.statusLabel,
      statusTone: this.batteryPercent < 18 ? 'warning' : mission.statusTone,
      actionPrompt:
        this.batteryPercent < 18
          ? 'Ease off throttle or idle briefly to recover solar reserve.'
          : mission.actionPrompt,
    };
    this.hud.updateTelemetry(telemetry);
  }

  private updateBattery(deltaSeconds: number, throttleInput: number, scanHeld: boolean): void {
    const drain =
      0.55 * deltaSeconds +
      Math.abs(throttleInput) * 1.1 * deltaSeconds +
      (scanHeld ? 0.9 * deltaSeconds : 0);
    const recharge = Math.abs(this.speedMps) < 8 && !scanHeld ? 0.7 * deltaSeconds : 0;
    this.batteryPercent = THREE.MathUtils.clamp(this.batteryPercent - drain + recharge, 6, 100);
  }

  private updateRoverTransform(): void {
    if (!this.terrainSystem) {
      return;
    }

    const up = this.terrainSystem.sampleNormal(this.roverPosition.x, this.roverPosition.z);
    const forward = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    forward.crossVectors(up, right).normalize();

    const matrix = new THREE.Matrix4().makeBasis(right, up, forward);
    this.rover.quaternion.setFromRotationMatrix(matrix);
    this.rover.position.copy(this.roverPosition);

    this.roverUp.copy(up);
    this.roverForward.copy(forward);
  }

  private updateCamera(deltaSeconds: number): void {
    this.cameraTarget
      .copy(this.roverPosition)
      .addScaledVector(this.roverUp, ROVER_DIMENSIONS.cameraTargetHeight);

    this.cameraForward
      .set(Math.sin(this.cameraOrbitYawRadians), 0, Math.cos(this.cameraOrbitYawRadians))
      .normalize();
    this.cameraRight.crossVectors(this.cameraForward, this.roverUp).normalize();
    this.cameraBack
      .copy(this.cameraForward)
      .multiplyScalar(-1)
      .normalize();

    this.cameraOffset
      .copy(this.cameraBack)
      .multiplyScalar(ROVER_DIMENSIONS.cameraDistance * Math.cos(this.cameraOrbitPitchRadians))
      .addScaledVector(
        this.roverUp,
        ROVER_DIMENSIONS.cameraDistance * Math.sin(this.cameraOrbitPitchRadians),
      );

    this.cameraDesired.copy(this.cameraTarget).add(this.cameraOffset);

    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-deltaSeconds * 2.8));
    this.camera.lookAt(this.cameraTarget);
  }

  private animateMarkers(deltaSeconds: number): void {
    const elapsed = this.clock.elapsedTime;
    for (const marker of this.markerStates.values()) {
      marker.group.rotation.y += deltaSeconds * 0.36;
      marker.group.position.y =
        marker.baseY + Math.sin(elapsed * 1.25 + marker.baseY * 0.00003) * 95;
    }
  }
}

function createMarker(color: string): THREE.Group {
  const group = new THREE.Group();
  const lineMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.72,
  });

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(28, 68, 3000, 12), lineMaterial);
  group.add(beam);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(420, 20, 8, 36), lineMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1460;
  group.add(ring);

  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(150, 0), lineMaterial);
  cap.position.y = 1600;
  group.add(cap);

  return group;
}
