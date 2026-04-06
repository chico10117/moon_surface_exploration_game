import './style.css';
import { MoonGame } from './game/MoonGame';
import type { HudBindings } from './game/ui/hud';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <canvas id="viewport" aria-label="Tycho crater terrain simulation"></canvas>
    <div class="chrome-grid" aria-hidden="true">
      <div class="grid-line grid-line-x"></div>
      <div class="grid-line grid-line-y"></div>
    </div>

    <section class="panel panel-brand">
      <p class="eyebrow">Lunar Survey Slice</p>
      <h1>Tycho Survey</h1>
      <p class="lede">
        Real lunar relief, streamed from a baked LOLA heightfield. The rover slice covers a
        measured corridor around Tycho crater with geology survey objectives and a follow-up EVA
        path.
      </p>
      <div class="chips">
        <span class="chip">Tycho crater</span>
        <span class="chip">LOLA 64 px/deg</span>
        <span class="chip">Rover-first mission</span>
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
      <p id="action-prompt" class="action-prompt">W/S drive, A/D steer, Shift boost, E scan.</p>
    </section>

    <section class="panel panel-controls">
      <p class="eyebrow">Controls</p>
      <ul class="control-list">
        <li><span>Drive</span><strong>W / S</strong></li>
        <li><span>Steer</span><strong>A / D</strong></li>
        <li><span>Boost</span><strong>Shift</strong></li>
        <li><span>Brake</span><strong>Space</strong></li>
        <li><span>Scan</span><strong>E</strong></li>
        <li><span>Reset</span><strong>R</strong></li>
      </ul>
    </section>
  </div>
`;

const hud: HudBindings = {
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
};

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const game = new MoonGame(canvas, hud);
void game.start();
