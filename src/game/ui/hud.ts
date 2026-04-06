import type { MissionManifest, RoverTelemetry } from '../types';

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
}

export class HudController {
  private readonly objectiveItems = new Map<string, HTMLLIElement>();

  constructor(private readonly bindings: HudBindings) {}

  public setMission(mission: MissionManifest): void {
    this.bindings.missionTitle.textContent = mission.title;
    this.bindings.missionCopy.textContent = mission.briefing;
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

  public updateObjectives(
    activeObjectiveId: string | null,
    completedObjectiveIds: Set<string>,
    returnUnlocked: boolean,
  ): void {
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

  public updateTelemetry(telemetry: RoverTelemetry): void {
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
}
