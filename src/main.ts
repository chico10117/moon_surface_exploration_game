import './style.css';
import { MoonGame } from './game/MoonGame';
import type { GameBindings } from './game/ui/hud';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <canvas id="viewport" aria-label="Tycho crater terrain simulation"></canvas>
    <div class="chrome-grid" aria-hidden="true">
      <div class="grid-line grid-line-x"></div>
      <div class="grid-line grid-line-y"></div>
    </div>
    <section id="vehicle-selector" class="vehicle-selector is-active is-loading">
      <div class="vehicle-selector-panel">
        <p class="eyebrow">Deployment Bay</p>
        <h2 id="selector-title">Preparing deployment</h2>
        <p id="selector-copy" class="selector-copy">
          Streaming terrain manifests and survey objectives.
        </p>
        <div class="selector-grid">
          <button
            id="select-rover"
            class="selector-card"
            type="button"
            disabled
            aria-describedby="selector-hint"
          >
            <span class="selector-kicker">1</span>
            <strong>Rover</strong>
            <span>Mission-capable survey vehicle with scans, braking, and ground contact.</span>
          </button>
          <button
            id="select-drone"
            class="selector-card"
            type="button"
            disabled
            aria-describedby="selector-hint"
          >
            <span class="selector-kicker">2</span>
            <strong>Drone</strong>
            <span>Fast recon scout for traversal only. Survey markers stay visible, but scans are disabled.</span>
          </button>
        </div>
        <p id="selector-hint" class="selector-hint">Press 1 for rover or 2 for drone.</p>
      </div>
    </section>

    <section class="panel panel-brand">
      <p class="eyebrow">Lunar Survey Slice</p>
      <h1>Tycho Survey</h1>
      <p class="lede">
        Real lunar relief, streamed from a baked LOLA heightfield. Deploy the survey rover for
        geology passes or launch a scout drone for rapid terrain reconnaissance across Tycho.
      </p>
      <div class="chips">
        <span class="chip">Tycho crater</span>
        <span class="chip">LOLA 64 px/deg</span>
        <span class="chip">Dual-vehicle deploy</span>
      </div>
    </section>

    <section class="panel panel-mission">
      <p class="eyebrow">Mission</p>
      <h2 id="mission-title">Initializing Survey Corridor</h2>
      <p id="mission-copy" class="panel-copy">Reading terrain manifests.</p>
      <ol id="objective-list" class="objective-list"></ol>
    </section>

    <section class="panel panel-telemetry">
      <div class="telemetry-row">
        <span class="telemetry-label">Speed</span>
        <span id="telemetry-speed" class="telemetry-value">0 km/h</span>
      </div>
      <div class="telemetry-row">
        <span class="telemetry-label">Slope</span>
        <span id="telemetry-slope" class="telemetry-value">0.0°</span>
      </div>
      <div class="telemetry-row">
        <span class="telemetry-label">Solar Reserve</span>
        <span id="telemetry-battery" class="telemetry-value">100%</span>
      </div>
      <div class="telemetry-row">
        <span class="telemetry-label">Terrain Stream</span>
        <span id="telemetry-streaming" class="telemetry-value">Boot mesh</span>
      </div>
      <div class="telemetry-row">
        <span class="telemetry-label">Active Tile</span>
        <span id="telemetry-tile" class="telemetry-value">r0c0</span>
      </div>
    </section>

    <section class="panel panel-status">
      <div class="status-pill" id="status-pill">Streaming terrain</div>
      <p id="action-prompt" class="action-prompt">
        Streaming terrain manifests.
      </p>
    </section>

    <section class="panel panel-controls">
      <p class="eyebrow">Controls</p>
      <ul id="control-list" class="control-list"></ul>
    </section>
  </div>
`;

const bindings: GameBindings = {
  missionTitle: document.querySelector<HTMLElement>('#mission-title')!,
  missionCopy: document.querySelector<HTMLElement>('#mission-copy')!,
  objectiveList: document.querySelector<HTMLOListElement>('#objective-list')!,
  telemetrySpeed: document.querySelector<HTMLElement>('#telemetry-speed')!,
  telemetrySlope: document.querySelector<HTMLElement>('#telemetry-slope')!,
  telemetryBattery: document.querySelector<HTMLElement>('#telemetry-battery')!,
  telemetryStreaming: document.querySelector<HTMLElement>('#telemetry-streaming')!,
  telemetryTile: document.querySelector<HTMLElement>('#telemetry-tile')!,
  statusPill: document.querySelector<HTMLElement>('#status-pill')!,
  actionPrompt: document.querySelector<HTMLElement>('#action-prompt')!,
  controlList: document.querySelector<HTMLUListElement>('#control-list')!,
  vehicleSelector: document.querySelector<HTMLElement>('#vehicle-selector')!,
  selectorTitle: document.querySelector<HTMLElement>('#selector-title')!,
  selectorCopy: document.querySelector<HTMLElement>('#selector-copy')!,
  selectorHint: document.querySelector<HTMLElement>('#selector-hint')!,
  roverSelectButton: document.querySelector<HTMLButtonElement>('#select-rover')!,
  droneSelectButton: document.querySelector<HTMLButtonElement>('#select-drone')!,
};

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const game = new MoonGame(canvas, bindings);
void game.start();
