import * as THREE from 'three';
import type { GameBindings } from './ui/hud';
import { HudController } from './ui/hud';
import { InputController } from './systems/input';
import { MissionController } from './systems/mission';
import { loadSiteData } from './terrain/terrainLoader';
import { TerrainSystem } from './terrain/terrainSystem';
import type { LoadedSiteData, VehicleMode, VehicleTelemetry } from './types';

interface MarkerState {
  id: string;
  group: THREE.Group;
  baseY: number;
}

interface RoverWheelState {
  steerPivot: THREE.Group;
  suspension: THREE.Group;
  wheel: THREE.Mesh;
  hub: THREE.Mesh;
  isFront: boolean;
  axleLocalY: number;
  contactLocalX: number;
  contactLocalZ: number;
  phase: number;
}

interface RoverPanelState {
  pivot: THREE.Group;
  side: -1 | 1;
}

interface RoverLightState {
  material: THREE.MeshStandardMaterial;
  kind: 'head' | 'brake';
  baseIntensity: number;
  boostIntensity: number;
  beam?: THREE.PointLight;
}

interface DroneThrusterState {
  material: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  kind: 'lift' | 'aft';
}

const ROVER_DIMENSIONS = {
  bodyWidth: 2.8,
  bodyHeight: 0.72,
  bodyLength: 3.9,
  bodyY: 0.88,
  deckWidth: 2.06,
  deckHeight: 0.34,
  deckLength: 2.62,
  deckY: 1.31,
  noseWidth: 2.32,
  noseHeight: 0.34,
  noseLength: 0.6,
  noseY: 1.02,
  noseZ: 2.1,
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
  wheelRadius: 0.5,
  wheelThickness: 0.28,
  wheelX: 1.26,
  wheelY: 0.5,
  wheelArmOffsetX: 0.42,
  wheelZFront: 1.34,
  wheelZMid: 0,
  wheelZRear: -1.34,
  panelWidth: 1.82,
  panelDepth: 1.28,
  panelThickness: 0.05,
  panelX: 1.72,
  panelY: 1.46,
  panelZ: 0.18,
  rideHeight: 0,
  suspensionTravel: 0.18,
  cameraTargetHeight: 1.75,
  cameraDistance: 24,
};

const DRONE_DIMENSIONS = {
  bodyLength: 2.6,
  bodyWidth: 2.2,
  bodyHeight: 0.62,
  cameraTargetHeight: 2.4,
  cameraDistance: 56,
};

const ROVER_TUNING = {
  cruiseSpeedMps: 280,
  boostSpeedMps: 420,
  reverseSpeedMps: 72,
  cruiseAcceleration: 80,
  boostAcceleration: 132,
  uphillResistance: 24,
  rollingDrag: 0.32,
  brakingDrag: 2.8,
  steeringLowSpeed: 1.02,
  steeringHighSpeed: 0.38,
  steeringBlendSpeed: 320,
  cameraFollowResponse: 4.6,
  cameraFovBoost: 7,
  cameraSpeedPullback: 12,
  cameraLookAhead: 10,
};

const DRONE_TUNING = {
  cruiseSpeedMps: 480,
  boostSpeedMps: 640,
  reverseSpeedMps: 160,
  climbSpeedMps: 120,
  cruiseAcceleration: 170,
  boostAcceleration: 250,
  cruiseDrag: 0.2,
  idleDrag: 0.38,
  steeringLowSpeed: 1.18,
  steeringHighSpeed: 0.62,
  steeringBlendSpeed: 620,
  minHoverHeight: 40,
  defaultHoverHeight: 140,
  maxHoverHeight: 1800,
  cameraFollowResponse: 5.2,
  cameraBaseFov: 60,
  cameraFovBoost: 9,
  cameraSpeedPullback: 32,
  cameraLookAhead: 38,
  orbitPitchRadians: 0.56,
};

export class MoonGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400000);
  private readonly clock = new THREE.Clock();
  private readonly input = new InputController();
  private readonly hud: HudController;
  private readonly bindings: GameBindings;
  private readonly rover = new THREE.Group();
  private readonly drone = new THREE.Group();
  private readonly droneTiltPivot = new THREE.Group();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraBack = new THREE.Vector3();
  private readonly vehiclePosition = new THREE.Vector3();
  private readonly vehicleUp = new THREE.Vector3(0, 1, 0);
  private readonly vehicleForward = new THREE.Vector3(0, 0, 1);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly markerStates = new Map<string, MarkerState>();
  private readonly wheelStates: RoverWheelState[] = [];
  private readonly solarPanelPivots: RoverPanelState[] = [];
  private readonly roverLights: RoverLightState[] = [];
  private readonly droneThrusters: DroneThrusterState[] = [];
  private readonly sensorRig = new THREE.Group();

  private siteData: LoadedSiteData | null = null;
  private terrainSystem: TerrainSystem | null = null;
  private missionController: MissionController | null = null;

  private vehicleMode: VehicleMode = 'rover';
  private runPhase: 'loading' | 'selecting' | 'active' = 'loading';
  private headingRadians = 0;
  private speedMps = 0;
  private batteryPercent = 100;
  private hoverHeightMeters = DRONE_TUNING.defaultHoverHeight;
  private cameraOrbitYawRadians = THREE.MathUtils.degToRad(18);
  private cameraOrbitPitchRadians = 0.42;
  private isDraggingCamera = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private wheelSpinRadians = 0;
  private steerVisualRadians = 0;
  private dronePitchRadians = 0;
  private droneRollRadians = 0;

  constructor(
    canvas: HTMLCanvasElement,
    bindings: GameBindings,
  ) {
    this.bindings = bindings;
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

    this.setupSceneScaffold();
    this.setupRover();
    this.setupDrone();
    this.setupCameraControls(canvas);
    this.setupVehicleSelector();
    window.addEventListener('resize', this.handleResize);
  }

  public async start(): Promise<void> {
    this.handleResize();
    this.showVehicleSelector('loading');

    const siteData = await loadSiteData();
    this.siteData = siteData;

    const terrainSystem = new TerrainSystem(this.scene, siteData.site, siteData.terrain);
    await terrainSystem.initialize();
    this.terrainSystem = terrainSystem;

    const missionController = new MissionController(siteData.mission);
    this.missionController = missionController;
    this.hud.setMission(siteData.mission);
    this.deployVehicle('rover');
    this.showVehicleSelector('selecting');

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
    const ambient = new THREE.AmbientLight('#c7cdd4', 0.1);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight('#fff8f1', 2.4);
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

  private setupVehicleSelector(): void {
    this.bindings.roverSelectButton.addEventListener('click', () => {
      this.beginRun('rover');
    });
    this.bindings.droneSelectButton.addEventListener('click', () => {
      this.beginRun('drone');
    });

    window.addEventListener('keydown', (event) => {
      if (this.runPhase !== 'selecting' || event.repeat) {
        return;
      }

      if (event.code === 'Digit1') {
        event.preventDefault();
        this.beginRun('rover');
      } else if (event.code === 'Digit2') {
        event.preventDefault();
        this.beginRun('drone');
      }
    });
  }

  private setupRover(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: '#d9dee2',
      roughness: 0.74,
      metalness: 0.12,
    });
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: '#162331',
      roughness: 0.44,
      metalness: 0.5,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: '#87bfd0',
      emissive: '#163746',
      emissiveIntensity: 0.24,
      roughness: 0.38,
      metalness: 0.24,
    });
    const darkMetalMaterial = new THREE.MeshStandardMaterial({
      color: '#3a424d',
      roughness: 0.82,
      metalness: 0.22,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: '#a3aeb9',
      roughness: 0.48,
      metalness: 0.42,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#d9f3ff',
      roughness: 0.04,
      metalness: 0.1,
      transparent: true,
      opacity: 0.78,
    });
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: '#25292f',
      roughness: 1,
      metalness: 0.04,
    });
    const thermalMaterial = new THREE.MeshStandardMaterial({
      color: '#c2c7c3',
      roughness: 0.58,
      metalness: 0.08,
    });
    const instrumentMaterial = new THREE.MeshStandardMaterial({
      color: '#6f818d',
      roughness: 0.34,
      metalness: 0.5,
    });

    this.wheelStates.length = 0;
    this.solarPanelPivots.length = 0;
    this.roverLights.length = 0;

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
    body.receiveShadow = true;
    this.rover.add(body);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.deckWidth,
        ROVER_DIMENSIONS.deckHeight,
        ROVER_DIMENSIONS.deckLength,
      ),
      bodyMaterial,
    );
    deck.position.y = ROVER_DIMENSIONS.deckY;
    deck.castShadow = true;
    this.rover.add(deck);

    const topPanel = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.06, 2.24), panelMaterial);
    topPanel.position.set(0, 1.46, 0.08);
    topPanel.castShadow = true;
    topPanel.receiveShadow = true;
    this.rover.add(topPanel);

    const panelFrame = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.08, 2.4), accentMaterial);
    panelFrame.position.set(0, 1.43, 0.08);
    panelFrame.castShadow = true;
    this.rover.add(panelFrame);

    const upperShell = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.26, 1.7), thermalMaterial);
    upperShell.position.set(0, 1.25, -0.02);
    upperShell.castShadow = true;
    this.rover.add(upperShell);

    const scienceBay = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.2, 0.86), instrumentMaterial);
    scienceBay.position.set(0, 1.62, -0.18);
    scienceBay.castShadow = true;
    this.rover.add(scienceBay);

    const instrumentDeck = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 0.62), accentMaterial);
    instrumentDeck.position.set(0, 1.38, 1.08);
    instrumentDeck.castShadow = true;
    this.rover.add(instrumentDeck);

    const noseFairing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.54), thermalMaterial);
    noseFairing.position.set(0, 1.12, 1.78);
    noseFairing.rotation.x = -0.08;
    noseFairing.castShadow = true;
    this.rover.add(noseFairing);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.noseWidth,
        ROVER_DIMENSIONS.noseHeight,
        ROVER_DIMENSIONS.noseLength,
      ),
      bodyMaterial,
    );
    nose.position.set(0, ROVER_DIMENSIONS.noseY, ROVER_DIMENSIONS.noseZ);
    nose.rotation.x = -0.18;
    nose.castShadow = true;
    this.rover.add(nose);

    const rearModule = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.42, 0.9), darkMetalMaterial);
    rearModule.position.set(0, 1.06, -1.82);
    rearModule.castShadow = true;
    this.rover.add(rearModule);

    const rearRack = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.18, 0.4), accentMaterial);
    rearRack.position.set(0, 1.36, -1.76);
    rearRack.castShadow = true;
    this.rover.add(rearRack);

    for (const side of [-1, 1] as const) {
      const canister = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.54), thermalMaterial);
      canister.position.set(side * 0.56, 1.24, -1.74);
      canister.castShadow = true;
      this.rover.add(canister);
    }

    const bellySkid = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.12, 2.44), darkMetalMaterial);
    bellySkid.position.set(0, 0.52, 0);
    bellySkid.receiveShadow = true;
    this.rover.add(bellySkid);

    const bumperBar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.35, 14), darkMetalMaterial);
    bumperBar.position.set(0, 0.78, 2.2);
    bumperBar.rotateZ(Math.PI / 2);
    bumperBar.castShadow = true;
    this.rover.add(bumperBar);

    const rearBar = bumperBar.clone();
    rearBar.position.z = -2.12;
    this.rover.add(rearBar);

    for (const side of [-1, 1] as const) {
      const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 3.34), darkMetalMaterial);
      sideSkirt.position.set(side * 1.52, 0.78, 0);
      sideSkirt.castShadow = true;
      this.rover.add(sideSkirt);

      const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 3.58), accentMaterial);
      sideRail.position.set(side * 1.34, 0.98, 0);
      sideRail.castShadow = true;
      this.rover.add(sideRail);

      const frontRocker = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 1.62), darkMetalMaterial);
      frontRocker.position.set(side * 1.08, 0.66, 0.74);
      frontRocker.rotation.z = side * 0.24;
      frontRocker.castShadow = true;
      this.rover.add(frontRocker);

      const rearRocker = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 1.62), darkMetalMaterial);
      rearRocker.position.set(side * 1.08, 0.66, -0.74);
      rearRocker.rotation.z = side * -0.2;
      rearRocker.castShadow = true;
      this.rover.add(rearRocker);

      const trussFront = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.54, 0.12), accentMaterial);
      trussFront.position.set(side * 1.18, 1.16, 1.06);
      trussFront.rotation.z = side * -0.22;
      trussFront.castShadow = true;
      this.rover.add(trussFront);

      const trussRear = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.54, 0.12), accentMaterial);
      trussRear.position.set(side * 1.18, 1.16, -0.98);
      trussRear.rotation.z = side * 0.22;
      trussRear.castShadow = true;
      this.rover.add(trussRear);
    }

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, ROVER_DIMENSIONS.mastHeight, 18),
      accentMaterial,
    );
    mast.position.y = ROVER_DIMENSIONS.mastHeight * 0.5;
    mast.castShadow = true;
    this.sensorRig.add(mast);

    const mastCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 18), thermalMaterial);
    mastCollar.position.y = 0.04;
    mastCollar.castShadow = true;
    this.sensorRig.add(mastCollar);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROVER_DIMENSIONS.headWidth,
        ROVER_DIMENSIONS.headHeight,
        ROVER_DIMENSIONS.headDepth,
      ),
      darkMetalMaterial,
    );
    head.position.set(0, ROVER_DIMENSIONS.mastHeight + 0.34, 0.06);
    head.castShadow = true;
    this.sensorRig.add(head);

    const cameraBar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.14), instrumentMaterial);
    cameraBar.position.set(0, ROVER_DIMENSIONS.mastHeight + 0.35, 0.32);
    cameraBar.castShadow = true;
    this.sensorRig.add(cameraBar);

    for (const side of [-1, 1] as const) {
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 14), glassMaterial);
      lens.position.set(side * 0.24, ROVER_DIMENSIONS.mastHeight + 0.34, 0.38);
      lens.castShadow = true;
      this.sensorRig.add(lens);
    }

    const antennaDish = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.1, 0.18, 24, 1, true), accentMaterial);
    antennaDish.position.set(0.78, ROVER_DIMENSIONS.mastHeight + 0.62, -0.06);
    antennaDish.rotation.z = Math.PI / 2.16;
    antennaDish.castShadow = true;
    this.sensorRig.add(antennaDish);

    const antennaRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 8, 28), accentMaterial);
    antennaRim.position.copy(antennaDish.position);
    antennaRim.rotation.copy(antennaDish.rotation);
    antennaRim.castShadow = true;
    this.sensorRig.add(antennaRim);

    const antennaBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.68, 12), darkMetalMaterial);
    antennaBoom.position.set(0.46, ROVER_DIMENSIONS.mastHeight + 0.56, -0.04);
    antennaBoom.rotation.z = Math.PI / 2.92;
    antennaBoom.castShadow = true;
    this.sensorRig.add(antennaBoom);

    const antennaFeed = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.24), trimMaterial);
    antennaFeed.position.set(0.6, ROVER_DIMENSIONS.mastHeight + 0.6, -0.06);
    antennaFeed.castShadow = true;
    this.sensorRig.add(antennaFeed);

    const navDome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 16), accentMaterial);
    navDome.position.set(-0.48, ROVER_DIMENSIONS.mastHeight + 0.54, -0.08);
    navDome.castShadow = true;
    this.sensorRig.add(navDome);

    const relayMast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.52, 10), instrumentMaterial);
    relayMast.position.set(-0.7, ROVER_DIMENSIONS.mastHeight + 0.52, 0.02);
    relayMast.castShadow = true;
    this.sensorRig.add(relayMast);

    const relayBar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.06), instrumentMaterial);
    relayBar.position.set(-0.7, ROVER_DIMENSIONS.mastHeight + 0.78, 0.02);
    relayBar.castShadow = true;
    this.sensorRig.add(relayBar);

    this.sensorRig.position.set(0, ROVER_DIMENSIONS.mastY, ROVER_DIMENSIONS.mastZ);
    this.rover.add(this.sensorRig);

    const armBase = new THREE.Group();
    armBase.position.set(0, 0.78, 2.12);
    armBase.rotation.x = -0.22;
    this.rover.add(armBase);

    const armShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.38, 14), accentMaterial);
    armShoulder.rotation.z = Math.PI / 2;
    armShoulder.castShadow = true;
    armBase.add(armShoulder);

    const armSegmentA = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.04), darkMetalMaterial);
    armSegmentA.position.set(0, -0.1, 0.58);
    armSegmentA.rotation.x = -0.42;
    armSegmentA.castShadow = true;
    armBase.add(armSegmentA);

    const armJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 14), accentMaterial);
    armJoint.position.set(0, -0.28, 1.02);
    armJoint.rotation.z = Math.PI / 2;
    armJoint.castShadow = true;
    armBase.add(armJoint);

    const armSegmentB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.82), darkMetalMaterial);
    armSegmentB.position.set(0, -0.38, 1.46);
    armSegmentB.rotation.x = -0.88;
    armSegmentB.castShadow = true;
    armBase.add(armSegmentB);

    const instrumentTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 16), instrumentMaterial);
    instrumentTurret.position.set(0, -0.62, 1.8);
    instrumentTurret.rotation.x = Math.PI / 2;
    instrumentTurret.castShadow = true;
    armBase.add(instrumentTurret);

    const instrumentLens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 16), trimMaterial);
    instrumentLens.position.set(0, -0.62, 1.94);
    instrumentLens.rotation.x = Math.PI / 2;
    instrumentLens.castShadow = true;
    armBase.add(instrumentLens);

    for (const side of [-1, 1] as const) {
      const panelPivot = new THREE.Group();
      panelPivot.position.set(
        side * ROVER_DIMENSIONS.panelX,
        ROVER_DIMENSIONS.panelY,
        ROVER_DIMENSIONS.panelZ,
      );

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(
          ROVER_DIMENSIONS.panelWidth,
          ROVER_DIMENSIONS.panelThickness,
          ROVER_DIMENSIONS.panelDepth,
        ),
        panelMaterial,
      );
      panel.position.x = side * (ROVER_DIMENSIONS.panelWidth * 0.5 + 0.12);
      panel.position.z = 0.06;
      panel.castShadow = true;
      panel.receiveShadow = true;
      panelPivot.add(panel);

      const panelStrut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.1), darkMetalMaterial);
      panelStrut.position.x = side * 0.24;
      panelStrut.position.y = -0.13;
      panelStrut.castShadow = true;
      panelPivot.add(panelStrut);

      const panelFrameWing = new THREE.Mesh(
        new THREE.BoxGeometry(
          ROVER_DIMENSIONS.panelWidth + 0.12,
          0.04,
          ROVER_DIMENSIONS.panelDepth + 0.12,
        ),
        accentMaterial,
      );
      panelFrameWing.position.set(side * (ROVER_DIMENSIONS.panelWidth * 0.5 + 0.12), -0.01, 0.06);
      panelFrameWing.castShadow = true;
      panelPivot.add(panelFrameWing);

      this.rover.add(panelPivot);
      this.solarPanelPivots.push({ pivot: panelPivot, side });
    }

    const registerMarkerLight = (
      position: THREE.Vector3,
      color: THREE.ColorRepresentation,
      kind: 'head' | 'brake',
      baseIntensity: number,
      boostIntensity: number,
      addBeam: boolean,
    ): void => {
      const lensMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: baseIntensity,
        roughness: 0.32,
        metalness: 0.15,
      });

      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), lensMaterial);
      lens.position.copy(position);
      lens.castShadow = true;
      this.rover.add(lens);

      let beam: THREE.PointLight | undefined;
      if (addBeam) {
        beam = new THREE.PointLight(color, baseIntensity * 0.8, 26, 2);
        beam.position.copy(position).add(new THREE.Vector3(0, 0.02, 0.18));
        this.rover.add(beam);
      }

      this.roverLights.push({ material: lensMaterial, kind, baseIntensity, boostIntensity, beam });
    };

    registerMarkerLight(new THREE.Vector3(-0.66, 1, 2.16), '#8edff8', 'head', 0.68, 1.9, true);
    registerMarkerLight(new THREE.Vector3(0.66, 1, 2.16), '#8edff8', 'head', 0.68, 1.9, true);
    registerMarkerLight(new THREE.Vector3(-0.78, 0.86, -2.06), '#ff4d3e', 'brake', 0.12, 2.7, false);
    registerMarkerLight(new THREE.Vector3(0.78, 0.86, -2.06), '#ff4d3e', 'brake', 0.12, 2.7, false);

    const wheelGeometry = new THREE.CylinderGeometry(
      ROVER_DIMENSIONS.wheelRadius,
      ROVER_DIMENSIONS.wheelRadius,
      ROVER_DIMENSIONS.wheelThickness,
      20,
    );
    wheelGeometry.rotateZ(Math.PI / 2);
    const hubGeometry = new THREE.CylinderGeometry(
      ROVER_DIMENSIONS.wheelRadius * 0.45,
      ROVER_DIMENSIONS.wheelRadius * 0.45,
      ROVER_DIMENSIONS.wheelThickness * 0.52,
      14,
    );
    hubGeometry.rotateZ(Math.PI / 2);

    const wheelOffsets: Array<[number, number, number, boolean, number]> = [
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZFront, true, 0.2],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZFront, true, 1.1],
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZMid, false, 2.1],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZMid, false, 3.2],
      [-ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZRear, false, 4.2],
      [ROVER_DIMENSIONS.wheelX, ROVER_DIMENSIONS.wheelY, ROVER_DIMENSIONS.wheelZRear, false, 5.1],
    ];

    for (const [x, y, z, isFront, phase] of wheelOffsets) {
      const side: -1 | 1 = x < 0 ? -1 : 1;
      const contactLocalX = x + side * ROVER_DIMENSIONS.wheelArmOffsetX;
      const steerPivot = new THREE.Group();
      steerPivot.position.set(x, y, z);

      const suspension = new THREE.Group();
      steerPivot.add(suspension);

      const rockerArm = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.18, 0.22), darkMetalMaterial);
      rockerArm.position.x = side * 0.3;
      rockerArm.castShadow = true;
      suspension.add(rockerArm);

      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.92, 10), darkMetalMaterial);
      axle.position.x = side * 0.42;
      axle.rotateZ(Math.PI / 2);
      axle.castShadow = true;
      suspension.add(axle);

      const damper = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 10), accentMaterial);
      damper.position.set(side * 0.28, 0.14, 0);
      damper.rotation.z = side * -0.54;
      damper.castShadow = true;
      suspension.add(damper);

      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.x = side * ROVER_DIMENSIONS.wheelArmOffsetX;
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      suspension.add(wheel);

      const hub = new THREE.Mesh(hubGeometry, trimMaterial);
      hub.position.x = side * ROVER_DIMENSIONS.wheelArmOffsetX;
      hub.castShadow = true;
      suspension.add(hub);

      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.52), bodyMaterial);
      fender.position.set(side * 0.78, 0.42, 0);
      fender.castShadow = true;
      steerPivot.add(fender);

      const housingBrace = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.14), accentMaterial);
      housingBrace.position.set(side * 0.5, 0.2, 0);
      housingBrace.castShadow = true;
      steerPivot.add(housingBrace);

      this.rover.add(steerPivot);
      this.wheelStates.push({
        steerPivot,
        suspension,
        wheel,
        hub,
        isFront,
        axleLocalY: y,
        contactLocalX,
        contactLocalZ: z,
        phase,
      });
    }

    this.scene.add(this.rover);
  }

  private setupDrone(): void {
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: '#c8d0d7',
      roughness: 0.58,
      metalness: 0.2,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: '#252d36',
      roughness: 0.86,
      metalness: 0.18,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: '#82d1f4',
      emissive: '#21465f',
      emissiveIntensity: 0.34,
      roughness: 0.32,
      metalness: 0.35,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#dff5ff',
      roughness: 0.05,
      metalness: 0.08,
      transparent: true,
      opacity: 0.72,
    });

    this.droneThrusters.length = 0;

    const fuselage = new THREE.Mesh(
      new THREE.BoxGeometry(
        DRONE_DIMENSIONS.bodyWidth,
        DRONE_DIMENSIONS.bodyHeight,
        DRONE_DIMENSIONS.bodyLength,
      ),
      shellMaterial,
    );
    fuselage.castShadow = true;
    fuselage.receiveShadow = true;
    this.droneTiltPivot.add(fuselage);

    const dorsalSpine = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.24, 1.6), darkMaterial);
    dorsalSpine.position.set(0, 0.36, 0.06);
    dorsalSpine.castShadow = true;
    this.droneTiltPivot.add(dorsalSpine);

    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.28, 0.8), glassMaterial);
    cockpit.position.set(0, 0.24, 0.72);
    cockpit.castShadow = true;
    this.droneTiltPivot.add(cockpit);

    const sensorSkid = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.5), darkMaterial);
    sensorSkid.position.set(0, -0.36, 0.74);
    sensorSkid.castShadow = true;
    this.droneTiltPivot.add(sensorSkid);

    const sensorBar = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.14), trimMaterial);
    sensorBar.position.set(0, 0.08, 1.16);
    sensorBar.castShadow = true;
    this.droneTiltPivot.add(sensorBar);

    const aftBoom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 1.26), darkMaterial);
    aftBoom.position.set(0, 0.02, -1.4);
    aftBoom.castShadow = true;
    this.droneTiltPivot.add(aftBoom);

    for (const side of [-1, 1] as const) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.12, 1.84), shellMaterial);
      wing.position.set(side * 1.08, -0.02, -0.08);
      wing.rotation.z = side * 0.14;
      wing.castShadow = true;
      this.droneTiltPivot.add(wing);

      const wingTip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.32), darkMaterial);
      wingTip.position.set(side * 1.55, 0.06, -0.74);
      wingTip.castShadow = true;
      this.droneTiltPivot.add(wingTip);

      const navLightMaterial = new THREE.MeshStandardMaterial({
        color: side < 0 ? '#8edff8' : '#ffb16f',
        emissive: side < 0 ? '#8edff8' : '#ffb16f',
        emissiveIntensity: 0.85,
        roughness: 0.28,
        metalness: 0.18,
      });
      const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), navLightMaterial);
      navLight.position.set(side * 1.62, 0.1, -0.74);
      navLight.castShadow = true;
      this.droneTiltPivot.add(navLight);
    }

    const buildThruster = (
      position: THREE.Vector3,
      rotationX: number,
      color: THREE.ColorRepresentation,
      kind: 'lift' | 'aft',
    ): void => {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.38, 18), darkMaterial);
      nozzle.position.copy(position);
      nozzle.rotation.x = rotationX;
      nozzle.castShadow = true;
      this.droneTiltPivot.add(nozzle);

      const glowMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.78,
        roughness: 0.2,
        metalness: 0,
      });
      const glow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.46, 16), glowMaterial);
      glow.position.copy(position);
      glow.rotation.x = rotationX;
      glow.translateY(-0.36);
      this.droneTiltPivot.add(glow);

      const light = new THREE.PointLight(color, 0.6, 36, 2.1);
      light.position.copy(position);
      light.position.add(
        kind === 'lift' ? new THREE.Vector3(0, -0.28, 0) : new THREE.Vector3(0, 0, 0.28),
      );
      this.droneTiltPivot.add(light);

      this.droneThrusters.push({ material: glowMaterial, light, kind });
    };

    buildThruster(new THREE.Vector3(-0.92, -0.18, -0.12), 0, '#74d6ff', 'lift');
    buildThruster(new THREE.Vector3(0.92, -0.18, -0.12), 0, '#74d6ff', 'lift');
    buildThruster(new THREE.Vector3(-0.54, -0.1, 0.92), Math.PI / 2, '#ffc477', 'aft');
    buildThruster(new THREE.Vector3(0.54, -0.1, 0.92), Math.PI / 2, '#ffc477', 'aft');

    this.drone.add(this.droneTiltPivot);
    this.drone.visible = false;
    this.scene.add(this.drone);
  }

  private beginRun(mode: VehicleMode): void {
    this.deployVehicle(mode);
    this.runPhase = 'active';
    this.input.clear();
    this.bindings.vehicleSelector.classList.remove('is-active', 'is-loading');
  }

  private showVehicleSelector(phase: 'loading' | 'selecting'): void {
    this.runPhase = phase;
    this.input.clear();
    if (phase === 'selecting') {
      this.speedMps = 0;
    }
    this.bindings.vehicleSelector.classList.add('is-active');
    this.bindings.vehicleSelector.classList.toggle('is-loading', phase === 'loading');
    this.bindings.roverSelectButton.disabled = phase === 'loading';
    this.bindings.droneSelectButton.disabled = phase === 'loading';

    if (phase === 'loading') {
      this.bindings.selectorTitle.textContent = 'Preparing deployment';
      this.bindings.selectorCopy.textContent =
        'Streaming terrain manifests and survey objectives.';
      this.bindings.selectorHint.textContent = 'Vehicle selection unlocks when the surface finishes loading.';
      return;
    }

    this.bindings.selectorTitle.textContent = 'Choose your vehicle';
    this.bindings.selectorCopy.textContent =
      'Deploy the rover to complete the survey, or launch the scout drone for fast recon. Press R at any time to return here.';
    this.bindings.selectorHint.textContent = 'Press 1 for rover or 2 for drone.';
  }

  private deployVehicle(mode: VehicleMode): void {
    if (!this.siteData || !this.terrainSystem || !this.missionController) {
      return;
    }

    this.vehicleMode = mode;
    this.headingRadians = THREE.MathUtils.degToRad(this.siteData.site.spawn.headingDegrees);
    this.speedMps = 0;
    this.batteryPercent = 100;
    this.hoverHeightMeters = DRONE_TUNING.defaultHoverHeight;
    this.wheelSpinRadians = 0;
    this.steerVisualRadians = 0;
    this.dronePitchRadians = 0;
    this.droneRollRadians = 0;
    this.cameraOrbitPitchRadians = mode === 'drone' ? DRONE_TUNING.orbitPitchRadians : 0.42;
    this.missionController.reset();
    this.hud.setVehicleMode(mode);

    const spawn = this.siteData.site.spawn;
    const terrainHeight = this.terrainSystem.sampleHeight(spawn.x, spawn.z);
    this.vehiclePosition.set(spawn.x, terrainHeight, spawn.z);
    this.rebuildMarkers();
    this.rover.visible = mode === 'rover';
    this.drone.visible = mode === 'drone';

    if (mode === 'rover') {
      this.resolveRoverPose(1);
      this.hud.updateObjectives(this.siteData.mission.objectives[0]?.id ?? null, new Set<string>(), false);
    } else {
      this.vehiclePosition.y = terrainHeight + this.hoverHeightMeters;
      this.vehicleUp.copy(this.worldUp);
      this.vehicleForward.set(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians)).normalize();
      this.updateDroneTransform();
    }

    this.updateCamera(1, true);
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

    const throttleInput = this.input.getAxis('KeyS', 'KeyW');
    const steerInput = this.input.getAxis('KeyD', 'KeyA');
    const boost = this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');
    const climbInput = this.vehicleMode === 'drone' ? this.input.getAxis('KeyQ', 'Space') : 0;
    const braking = this.vehicleMode === 'rover' && this.input.isPressed('Space');
    const scanHeld =
      this.vehicleMode === 'rover' &&
      this.runPhase === 'active' &&
      this.input.isPressed('KeyE');

    if (this.runPhase === 'active' && this.input.isPressed('KeyR')) {
      this.showVehicleSelector('selecting');
    }

    this.terrainSystem.update(this.vehiclePosition, this.vehicleMode === 'drone' ? 2 : 1);

    const surfaceNormal = this.terrainSystem.sampleNormal(this.vehiclePosition.x, this.vehiclePosition.z);
    const slopeDegrees = THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(surfaceNormal.y, -1, 1)),
    );
    let statusLabel = 'Awaiting deployment';
    let statusTone: VehicleTelemetry['statusTone'] = 'default';
    let actionPrompt = 'Choose Rover or Drone to start a new run.';

    if (this.runPhase === 'active') {
      if (this.vehicleMode === 'rover') {
        this.updateRoverMovement(deltaSeconds, throttleInput, steerInput, boost, braking, slopeDegrees, surfaceNormal);
        this.updateRoverBattery(deltaSeconds, throttleInput, scanHeld);
        this.resolveRoverPose(deltaSeconds);
        this.animateRoverVisuals(deltaSeconds, steerInput, braking, scanHeld);

        const mission = this.missionController.update({
          roverPosition: this.vehiclePosition,
          roverSpeedMps: Math.abs(this.speedMps),
          scanHeld,
          deltaSeconds,
        });

        this.hud.updateObjectives(
          mission.activeObjective?.id ?? null,
          mission.completedObjectiveIds,
          mission.returnUnlocked,
        );

        statusLabel = this.batteryPercent < 18 ? 'Low solar reserve' : mission.statusLabel;
        statusTone = this.batteryPercent < 18 ? 'warning' : mission.statusTone;
        actionPrompt =
          this.batteryPercent < 18
            ? 'Ease off throttle or idle briefly to recover solar reserve.'
            : mission.actionPrompt;
      } else {
        this.updateDroneMovement(deltaSeconds, throttleInput, steerInput, climbInput, boost);
        this.updateDroneBattery(deltaSeconds, throttleInput, climbInput, boost);
        this.animateDroneVisuals(deltaSeconds, steerInput, throttleInput, climbInput, boost);
        statusLabel = this.batteryPercent < 18 ? 'Low solar reserve' : 'Recon flight active';
        statusTone = this.batteryPercent < 18 ? 'warning' : 'stable';
        actionPrompt =
          this.batteryPercent < 18
            ? 'Ease off thrust or hover briefly to recover solar reserve.'
            : 'Scout freely with W/S thrust, Space climb, Q descend, and press R to redeploy.';
      }
    } else {
      if (this.vehicleMode === 'rover') {
        this.animateRoverVisuals(deltaSeconds, 0, false, false);
      } else {
        this.animateDroneVisuals(deltaSeconds, 0, 0, 0, false);
      }

      if (this.runPhase === 'loading') {
        statusLabel = 'Streaming terrain';
        actionPrompt = 'Preparing terrain and mission data.';
      } else {
        statusTone = 'stable';
      }
    }

    this.updateCamera(deltaSeconds);
    this.animateMarkers(deltaSeconds);

    const telemetry: VehicleTelemetry = {
      speedMps: Math.abs(this.speedMps),
      slopeDegrees,
      batteryPercent: this.batteryPercent,
      activeTileKey: this.terrainSystem.getActiveTileKey(),
      streamingLabel: this.terrainSystem.getStreamingLabel(),
      statusLabel,
      statusTone,
      actionPrompt,
    };
    this.hud.updateTelemetry(telemetry);
  }

  private updateRoverMovement(
    deltaSeconds: number,
    throttleInput: number,
    steerInput: number,
    boost: boolean,
    braking: boolean,
    slopeDegrees: number,
    surfaceNormal: THREE.Vector3,
  ): void {
    const forwardOnPlane = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .normalize();
    const uphillFactor = surfaceNormal.dot(forwardOnPlane);
    const maxSpeed = boost ? ROVER_TUNING.boostSpeedMps : ROVER_TUNING.cruiseSpeedMps;
    const acceleration = boost ? ROVER_TUNING.boostAcceleration : ROVER_TUNING.cruiseAcceleration;
    const drag = braking ? ROVER_TUNING.brakingDrag : ROVER_TUNING.rollingDrag;
    const slopePenalty = THREE.MathUtils.clamp((slopeDegrees - 8) / 24, 0, 0.8);
    const grip = 1 - slopePenalty * 0.7;

    this.headingRadians +=
      steerInput *
      deltaSeconds *
      THREE.MathUtils.lerp(
        ROVER_TUNING.steeringLowSpeed,
        ROVER_TUNING.steeringHighSpeed,
        Math.min(1, Math.abs(this.speedMps) / ROVER_TUNING.steeringBlendSpeed),
      );
    this.speedMps += throttleInput * acceleration * grip * deltaSeconds;
    this.speedMps -= uphillFactor * ROVER_TUNING.uphillResistance * deltaSeconds;
    this.speedMps *= Math.exp(-drag * deltaSeconds);
    this.speedMps = THREE.MathUtils.clamp(
      this.speedMps,
      -ROVER_TUNING.reverseSpeedMps,
      maxSpeed * Math.max(0.22, this.batteryPercent / 100),
    );

    const movement = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .multiplyScalar(this.speedMps * deltaSeconds);
    this.vehiclePosition.x += movement.x;
    this.vehiclePosition.z += movement.z;
    this.clampVehicleHorizontalPosition();
  }

  private updateDroneMovement(
    deltaSeconds: number,
    throttleInput: number,
    steerInput: number,
    climbInput: number,
    boost: boolean,
  ): void {
    const acceleration = boost ? DRONE_TUNING.boostAcceleration : DRONE_TUNING.cruiseAcceleration;
    const maxSpeed = boost ? DRONE_TUNING.boostSpeedMps : DRONE_TUNING.cruiseSpeedMps;
    const drag = Math.abs(throttleInput) > 0 ? DRONE_TUNING.cruiseDrag : DRONE_TUNING.idleDrag;

    this.headingRadians +=
      steerInput *
      deltaSeconds *
      THREE.MathUtils.lerp(
        DRONE_TUNING.steeringLowSpeed,
        DRONE_TUNING.steeringHighSpeed,
        Math.min(1, Math.abs(this.speedMps) / DRONE_TUNING.steeringBlendSpeed),
      );
    this.speedMps += throttleInput * acceleration * deltaSeconds;
    this.speedMps *= Math.exp(-drag * deltaSeconds);
    this.speedMps = THREE.MathUtils.clamp(
      this.speedMps,
      -DRONE_TUNING.reverseSpeedMps,
      maxSpeed * Math.max(0.34, this.batteryPercent / 100),
    );

    const movement = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .multiplyScalar(this.speedMps * deltaSeconds);
    this.vehiclePosition.x += movement.x;
    this.vehiclePosition.z += movement.z;
    this.clampVehicleHorizontalPosition();

    this.hoverHeightMeters = THREE.MathUtils.clamp(
      this.hoverHeightMeters + climbInput * DRONE_TUNING.climbSpeedMps * deltaSeconds,
      DRONE_TUNING.minHoverHeight,
      DRONE_TUNING.maxHoverHeight,
    );

    const groundHeight = this.terrainSystem!.sampleHeight(this.vehiclePosition.x, this.vehiclePosition.z);
    this.vehiclePosition.y = groundHeight + this.hoverHeightMeters;
    this.vehicleUp.copy(this.worldUp);
    this.vehicleForward.set(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians)).normalize();
    this.updateDroneTransform();
  }

  private clampVehicleHorizontalPosition(): void {
    if (!this.siteData) {
      return;
    }

    const world = this.siteData.site.world;
    this.vehiclePosition.x = THREE.MathUtils.clamp(
      this.vehiclePosition.x,
      -world.widthMeters * 0.48,
      world.widthMeters * 0.48,
    );
    this.vehiclePosition.z = THREE.MathUtils.clamp(
      this.vehiclePosition.z,
      -world.heightMeters * 0.48,
      world.heightMeters * 0.48,
    );
  }

  private updateRoverBattery(deltaSeconds: number, throttleInput: number, scanHeld: boolean): void {
    const drain =
      0.55 * deltaSeconds +
      Math.abs(throttleInput) * 1.1 * deltaSeconds +
      (scanHeld ? 0.9 * deltaSeconds : 0);
    const recharge = Math.abs(this.speedMps) < 8 && !scanHeld ? 0.7 * deltaSeconds : 0;
    this.batteryPercent = THREE.MathUtils.clamp(this.batteryPercent - drain + recharge, 6, 100);
  }

  private updateDroneBattery(
    deltaSeconds: number,
    throttleInput: number,
    climbInput: number,
    boost: boolean,
  ): void {
    const drain =
      0.34 * deltaSeconds +
      Math.abs(throttleInput) * 0.46 * deltaSeconds +
      Math.abs(climbInput) * 0.3 * deltaSeconds +
      (boost ? 0.52 * deltaSeconds : 0);
    const recharge =
      Math.abs(this.speedMps) < 22 && Math.abs(climbInput) < 0.1 ? 0.36 * deltaSeconds : 0;
    this.batteryPercent = THREE.MathUtils.clamp(this.batteryPercent - drain + recharge, 10, 100);
  }

  private animateRoverVisuals(
    deltaSeconds: number,
    steerInput: number,
    braking: boolean,
    scanHeld: boolean,
  ): void {
    this.wheelSpinRadians +=
      (this.speedMps / Math.max(ROVER_DIMENSIONS.wheelRadius, 0.01)) * deltaSeconds;

    const steerTarget = THREE.MathUtils.clamp(steerInput * 0.48, -0.48, 0.48);
    this.steerVisualRadians = THREE.MathUtils.lerp(
      this.steerVisualRadians,
      steerTarget,
      1 - Math.exp(-deltaSeconds * 9),
    );

    const elapsed = this.clock.elapsedTime;

    for (const wheelState of this.wheelStates) {
      wheelState.steerPivot.rotation.y = wheelState.isFront
        ? this.steerVisualRadians
        : this.steerVisualRadians * 0.16;
      wheelState.wheel.rotation.x = this.wheelSpinRadians;
      wheelState.hub.rotation.x = this.wheelSpinRadians * 0.7;
    }

    for (const panelState of this.solarPanelPivots) {
      const batteryFold = THREE.MathUtils.lerp(0.08, 0.24, (100 - this.batteryPercent) / 100);
      panelState.pivot.rotation.z =
        panelState.side * batteryFold + Math.sin(elapsed * 0.72 + panelState.side) * 0.014;
    }

    const speedFactor = Math.min(1, Math.abs(this.speedMps) / ROVER_TUNING.boostSpeedMps);
    const scanPulse = scanHeld ? 0.45 + Math.max(0, Math.sin(elapsed * 10)) * 0.35 : 0;
    for (const lightState of this.roverLights) {
      const response =
        lightState.kind === 'head'
          ? 0.25 + speedFactor * 0.22 + scanPulse
          : braking
            ? 1
            : Math.min(0.2, speedFactor * 0.1);
      const intensity = lightState.baseIntensity + lightState.boostIntensity * response;
      lightState.material.emissiveIntensity = intensity;
      if (lightState.beam) {
        lightState.beam.intensity = intensity * 0.82;
      }
    }

    this.sensorRig.rotation.y += deltaSeconds * (0.16 + Math.abs(steerInput) * 0.42);
    this.sensorRig.rotation.x = 0.05 + Math.sin(elapsed * 1.1) * 0.03;
  }

  private animateDroneVisuals(
    deltaSeconds: number,
    steerInput: number,
    throttleInput: number,
    climbInput: number,
    boost: boolean,
  ): void {
    const elapsed = this.clock.elapsedTime;
    const speedFactor = Math.min(1, Math.abs(this.speedMps) / DRONE_TUNING.boostSpeedMps);
    const pitchTarget = THREE.MathUtils.clamp(
      -throttleInput * 0.2 - climbInput * 0.08 - speedFactor * 0.06,
      -0.34,
      0.18,
    );
    const rollTarget = THREE.MathUtils.clamp(-steerInput * 0.22, -0.26, 0.26);
    this.dronePitchRadians = THREE.MathUtils.lerp(
      this.dronePitchRadians,
      pitchTarget,
      1 - Math.exp(-deltaSeconds * 5.8),
    );
    this.droneRollRadians = THREE.MathUtils.lerp(
      this.droneRollRadians,
      rollTarget,
      1 - Math.exp(-deltaSeconds * 6.4),
    );

    this.droneTiltPivot.rotation.x = this.dronePitchRadians;
    this.droneTiltPivot.rotation.z = this.droneRollRadians;
    this.droneTiltPivot.position.y = Math.sin(elapsed * 3.1) * 0.08;

    for (const thruster of this.droneThrusters) {
      const response =
        thruster.kind === 'lift'
          ? 0.68 + speedFactor * 0.28 + Math.abs(climbInput) * 0.35 + (boost ? 0.12 : 0)
          : 0.3 + Math.max(0, throttleInput) * 0.6 + speedFactor * 0.16 + (boost ? 0.18 : 0);
      thruster.material.emissiveIntensity = response;
      thruster.light.intensity = response * 1.2;
    }
  }

  private updateRoverTransform(): void {
    const up = this.vehicleUp;
    const forward = this.vehicleForward;
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();

    const matrix = new THREE.Matrix4().makeBasis(right, up, forward);
    this.rover.quaternion.setFromRotationMatrix(matrix);
    this.rover.position.copy(this.vehiclePosition);
  }

  private updateDroneTransform(): void {
    const right = new THREE.Vector3().crossVectors(this.vehicleUp, this.vehicleForward).normalize();
    const matrix = new THREE.Matrix4().makeBasis(right, this.vehicleUp, this.vehicleForward);
    this.drone.quaternion.setFromRotationMatrix(matrix);
    this.drone.position.copy(this.vehiclePosition);
  }

  private resolveRoverPose(deltaSeconds: number): void {
    if (!this.terrainSystem || this.wheelStates.length === 0) {
      this.updateRoverTransform();
      return;
    }

    const flatForward = new THREE.Vector3(Math.sin(this.headingRadians), 0, Math.cos(this.headingRadians))
      .normalize();
    const flatRight = new THREE.Vector3().crossVectors(this.worldUp, flatForward).normalize();
    const contactSamples = this.wheelStates.map((wheelState) => {
      const worldX =
        this.vehiclePosition.x +
        flatRight.x * wheelState.contactLocalX +
        flatForward.x * wheelState.contactLocalZ;
      const worldZ =
        this.vehiclePosition.z +
        flatRight.z * wheelState.contactLocalX +
        flatForward.z * wheelState.contactLocalZ;

      return {
        wheelState,
        localX: wheelState.contactLocalX,
        localZ: wheelState.contactLocalZ,
        groundHeight: this.terrainSystem!.sampleHeight(worldX, worldZ),
        worldX,
        worldZ,
      };
    });

    const frontPoint = averageContactPoint(contactSamples.filter((sample) => sample.wheelState.isFront));
    const rearPoint = averageContactPoint(contactSamples.filter((sample) => sample.localZ < 0));
    const leftPoint = averageContactPoint(contactSamples.filter((sample) => sample.localX < 0));
    const rightPoint = averageContactPoint(contactSamples.filter((sample) => sample.localX > 0));

    const forward = frontPoint.clone().sub(rearPoint);
    if (forward.lengthSq() < 1e-4) {
      forward.copy(flatForward);
    } else {
      forward.normalize();
    }

    const right = rightPoint.clone().sub(leftPoint);
    if (right.lengthSq() < 1e-4) {
      right.copy(flatRight);
    } else {
      right.normalize();
    }

    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    if (up.y < 0) {
      up.multiplyScalar(-1);
    }

    right.crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();

    let originY = 0;
    for (const sample of contactSamples) {
      originY += sample.groundHeight - right.y * sample.localX - forward.y * sample.localZ;
    }
    this.vehiclePosition.y = originY / contactSamples.length + ROVER_DIMENSIONS.rideHeight;

    this.vehicleUp.copy(up);
    this.vehicleForward.copy(forward);

    const suspensionBlend = 1 - Math.exp(-deltaSeconds * 16);
    for (const sample of contactSamples) {
      const baseWheelCenterY =
        this.vehiclePosition.y +
        right.y * sample.localX +
        up.y * sample.wheelState.axleLocalY +
        forward.y * sample.localZ;
      const desiredSuspension =
        (sample.groundHeight + ROVER_DIMENSIONS.wheelRadius - baseWheelCenterY) /
        Math.max(up.y, 0.35);
      const clampedSuspension = THREE.MathUtils.clamp(
        desiredSuspension,
        -ROVER_DIMENSIONS.suspensionTravel,
        ROVER_DIMENSIONS.suspensionTravel,
      );
      sample.wheelState.suspension.position.y = THREE.MathUtils.lerp(
        sample.wheelState.suspension.position.y,
        clampedSuspension,
        suspensionBlend,
      );
    }

    this.updateRoverTransform();
  }

  private updateCamera(deltaSeconds: number, snap = false): void {
    const isDrone = this.vehicleMode === 'drone';
    const speedFactor = Math.min(
      1,
      Math.abs(this.speedMps) / (isDrone ? DRONE_TUNING.boostSpeedMps : ROVER_TUNING.boostSpeedMps),
    );
    const chaseDistance =
      (isDrone ? DRONE_DIMENSIONS.cameraDistance : ROVER_DIMENSIONS.cameraDistance) +
      (isDrone ? DRONE_TUNING.cameraSpeedPullback : ROVER_TUNING.cameraSpeedPullback) *
        Math.pow(speedFactor, 0.85);
    const lookAhead =
      (isDrone ? DRONE_TUNING.cameraLookAhead : ROVER_TUNING.cameraLookAhead) * speedFactor;

    this.cameraTarget
      .copy(this.vehiclePosition)
      .addScaledVector(
        this.vehicleUp,
        (isDrone ? DRONE_DIMENSIONS.cameraTargetHeight : ROVER_DIMENSIONS.cameraTargetHeight) +
          speedFactor * (isDrone ? 0.52 : 0.28),
      )
      .addScaledVector(this.vehicleForward, lookAhead);

    this.cameraForward
      .set(Math.sin(this.cameraOrbitYawRadians), 0, Math.cos(this.cameraOrbitYawRadians))
      .normalize();
    this.cameraRight.crossVectors(this.cameraForward, this.vehicleUp).normalize();
    this.cameraBack
      .copy(this.cameraForward)
      .multiplyScalar(-1)
      .normalize();

    this.cameraOffset
      .copy(this.cameraBack)
      .multiplyScalar(chaseDistance * Math.cos(this.cameraOrbitPitchRadians))
      .addScaledVector(
        this.vehicleUp,
        chaseDistance * Math.sin(this.cameraOrbitPitchRadians),
      );

    this.cameraDesired.copy(this.cameraTarget).add(this.cameraOffset);

    if (snap) {
      this.camera.position.copy(this.cameraDesired);
    } else {
      this.camera.position.lerp(
        this.cameraDesired,
        1 -
          Math.exp(
            -deltaSeconds *
              (isDrone ? DRONE_TUNING.cameraFollowResponse : ROVER_TUNING.cameraFollowResponse),
          ),
      );
    }
    const targetFov =
      (isDrone ? DRONE_TUNING.cameraBaseFov : 52) +
      (isDrone ? DRONE_TUNING.cameraFovBoost : ROVER_TUNING.cameraFovBoost) * speedFactor;
    this.camera.fov = snap
      ? targetFov
      : THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-deltaSeconds * 5.5));
    this.camera.updateProjectionMatrix();
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

function averageContactPoint(
  samples: Array<{ groundHeight: number; worldX: number; worldZ: number }>,
): THREE.Vector3 {
  if (samples.length === 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  const point = new THREE.Vector3();
  for (const sample of samples) {
    point.x += sample.worldX;
    point.y += sample.groundHeight;
    point.z += sample.worldZ;
  }

  return point.multiplyScalar(1 / samples.length);
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
