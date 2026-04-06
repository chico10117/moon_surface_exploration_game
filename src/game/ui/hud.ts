import type { MissionManifest, VehicleMode, VehicleTelemetry } from '../types';

export interface HudBindings {
  missionTitle: HTMLElement;
  missionCopy: HTMLElement;
  objectiveList: HTMLOListElement;
  telemetrySpeed: HTMLElement;
  telemetrySlope: HTMLElement;
  telemetryBattery: HTMLElement;
  telemetryStreaming: HTMLElement;
  telemetryTile: HTMLElement;
  statusPill: HTMLElement;
  actionPrompt: HTMLElement;
  controlList: HTMLUListElement;
}

export interface GameBindings extends HudBindings {
  vehicleSelector: HTMLElement;
  selectorTitle: HTMLElement;
  selectorCopy: HTMLElement;
  selectorHint: HTMLElement;
  roverSelectButton: HTMLButtonElement;
  droneSelectButton: HTMLButtonElement;
}

export class HudController {
  private readonly objectiveItems = new Map<string, HTMLLIElement>();
  private mission: MissionManifest | null = null;
  private vehicleMode: VehicleMode = 'rover';

  constructor(private readonly bindings: HudBindings) {
    this.renderControls();
  }

  public setMission(mission: MissionManifest): void {
    this.mission = mission;
    this.renderMission();
    this.bindings.objectiveList.innerHTML = '';
    this.objectiveItems.clear();

    for (const [index, objective] of mission.objectives.entries()) {
      const item = document.createElement('li');
      item.dataset.objectiveId = objective.id;
      item.innerHTML = `
        <span class="objective-index">${index + 1}</span>
        <div class="objective-main">
          <strong>${objective.label}</strong>
          <span>${objective.note}</span>
        </div>
        <span class="objective-state pending">Pending</span>
      `;
      this.bindings.objectiveList.append(item);
      this.objectiveItems.set(objective.id, item);
    }
  }

  public setVehicleMode(mode: VehicleMode): void {
    this.vehicleMode = mode;
    this.renderMission();
    this.renderControls();
  }

  public updateObjectives(
    activeObjectiveId: string | null,
    completedObjectiveIds: Set<string>,
    returnUnlocked: boolean,
  ): void {
    if (this.vehicleMode !== 'rover') {
      return;
    }

    for (const [id, item] of this.objectiveItems.entries()) {
      const state = item.querySelector<HTMLElement>('.objective-state');
      if (!state) {
        continue;
      }

      state.className = 'objective-state';
      if (completedObjectiveIds.has(id)) {
        state.textContent = 'Complete';
        state.classList.add('complete');
      } else if (activeObjectiveId === id) {
        state.textContent = 'Active';
        state.classList.add('active');
      } else {
        state.textContent = 'Pending';
        state.classList.add('pending');
      }
    }

    if (returnUnlocked) {
      this.bindings.missionCopy.textContent =
        'Survey set complete. Return the rover to the deployment zone to seal the run.';
    }
  }

  public updateTelemetry(telemetry: VehicleTelemetry): void {
    this.bindings.telemetrySpeed.textContent = `${Math.round(telemetry.speedMps * 3.6)} km/h`;
    this.bindings.telemetrySlope.textContent = `${telemetry.slopeDegrees.toFixed(1)}°`;
    this.bindings.telemetryBattery.textContent = `${telemetry.batteryPercent.toFixed(0)}%`;
    this.bindings.telemetryStreaming.textContent = telemetry.streamingLabel;
    this.bindings.telemetryTile.textContent = telemetry.activeTileKey;

    this.bindings.statusPill.textContent = telemetry.statusLabel;
    this.bindings.statusPill.classList.remove('stable', 'warning');
    if (telemetry.statusTone === 'stable') {
      this.bindings.statusPill.classList.add('stable');
    } else if (telemetry.statusTone === 'warning') {
      this.bindings.statusPill.classList.add('warning');
    }

    this.bindings.actionPrompt.textContent = telemetry.actionPrompt;
  }

  private renderMission(): void {
    if (!this.mission) {
      return;
    }

    if (this.vehicleMode === 'drone') {
      this.bindings.missionTitle.textContent = 'Recon Flight';
      this.bindings.missionCopy.textContent =
        'Deploy the scout drone for fast terrain reconnaissance. Survey beacons stay visible, but scans and mission sealing require the rover.';
      this.bindings.objectiveList.hidden = true;
      return;
    }

    this.bindings.missionTitle.textContent = this.mission.title;
    this.bindings.missionCopy.textContent = this.mission.briefing;
    this.bindings.objectiveList.hidden = false;
  }

  private renderControls(): void {
    const controls =
      this.vehicleMode === 'drone'
        ? [
            ['Thrust', 'W / S'],
            ['Yaw', 'A / D'],
            ['Climb', 'Space'],
            ['Descend', 'Q'],
            ['Boost', 'Shift'],
            ['Orbit Camera', 'Mouse drag'],
            ['Zoom', 'Scroll'],
            ['Reset', 'R'],
          ]
        : [
            ['Drive', 'W / S'],
            ['Steer', 'A / D'],
            ['Orbit Camera', 'Mouse drag'],
            ['Zoom', 'Scroll'],
            ['Boost', 'Shift'],
            ['Brake', 'Space'],
            ['Scan', 'E'],
            ['Reset', 'R'],
          ];

    this.bindings.controlList.innerHTML = controls
      .map(
        ([label, value]) =>
          `<li><span>${label}</span><strong>${value}</strong></li>`,
      )
      .join('');
  }
}
