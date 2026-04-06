import * as THREE from 'three';
import type { MissionManifest, MissionObjective } from '../types';

export interface MissionUpdateContext {
  roverPosition: THREE.Vector3;
  roverSpeedMps: number;
  scanHeld: boolean;
  deltaSeconds: number;
}

export interface MissionUpdateResult {
  activeObjective: MissionObjective | null;
  completedObjectiveIds: Set<string>;
  returnUnlocked: boolean;
  completed: boolean;
  actionPrompt: string;
  statusLabel: string;
  statusTone: 'default' | 'stable' | 'warning';
}

export class MissionController {
  private readonly completedIds = new Set<string>();
  private activeObjectiveIndex = 0;
  private currentScanProgressSeconds = 0;
  private returnComplete = false;

  constructor(private readonly mission: MissionManifest) {}

  public reset(): void {
    this.completedIds.clear();
    this.activeObjectiveIndex = 0;
    this.currentScanProgressSeconds = 0;
    this.returnComplete = false;
  }

  public getActiveObjective(): MissionObjective | null {
    if (this.activeObjectiveIndex >= this.mission.objectives.length) {
      return null;
    }

    return this.mission.objectives[this.activeObjectiveIndex];
  }

  public update(context: MissionUpdateContext): MissionUpdateResult {
    const activeObjective = this.getActiveObjective();
    const withinObjective =
      activeObjective &&
      horizontalDistance(context.roverPosition, activeObjective) <= activeObjective.radiusMeters;

    if (activeObjective) {
      if (withinObjective && context.roverSpeedMps <= 14 && context.scanHeld) {
        this.currentScanProgressSeconds += context.deltaSeconds;
        if (this.currentScanProgressSeconds >= activeObjective.scanDurationSeconds) {
          this.completedIds.add(activeObjective.id);
          this.activeObjectiveIndex += 1;
          this.currentScanProgressSeconds = 0;
        }
      } else if (!context.scanHeld) {
        this.currentScanProgressSeconds = Math.max(
          0,
          this.currentScanProgressSeconds - context.deltaSeconds * 0.45,
        );
      }
    } else {
      const returnDistance = horizontalDistance(context.roverPosition, this.mission.returnZone);
      if (returnDistance <= this.mission.returnZone.radiusMeters) {
        this.returnComplete = true;
      }
    }

    const currentObjective = this.getActiveObjective();
    const returnUnlocked = currentObjective === null;

    let actionPrompt = 'Drive toward the active survey beacon.';
    let statusLabel = 'Survey in progress';
    let statusTone: 'default' | 'stable' | 'warning' = 'default';

    if (currentObjective) {
      const distance = horizontalDistance(context.roverPosition, currentObjective);
      if (distance <= currentObjective.radiusMeters) {
        if (context.roverSpeedMps > 14) {
          actionPrompt = 'Hold position. The rover must be nearly still to start the scan.';
          statusLabel = 'Stabilize rover';
          statusTone = 'warning';
        } else if (context.scanHeld) {
          actionPrompt = `Scanning ${Math.min(
            100,
            Math.round((this.currentScanProgressSeconds / currentObjective.scanDurationSeconds) * 100),
          )}%`;
          statusLabel = 'Sensor suite active';
          statusTone = 'stable';
        } else {
          actionPrompt = 'Inside scan radius. Hold E to log the geology pass.';
          statusLabel = 'Ready to scan';
          statusTone = 'stable';
        }
      } else {
        actionPrompt = `Navigate to ${currentObjective.label}.`;
      }
    } else if (!this.returnComplete) {
      actionPrompt = 'All surveys logged. Return to the deployment marker.';
      statusLabel = 'Return window open';
      statusTone = 'stable';
    } else {
      actionPrompt = 'Mission sealed. Press R to redeploy the rover.';
      statusLabel = 'Survey complete';
      statusTone = 'stable';
    }

    return {
      activeObjective: currentObjective,
      completedObjectiveIds: new Set(this.completedIds),
      returnUnlocked,
      completed: this.returnComplete,
      actionPrompt,
      statusLabel,
      statusTone,
    };
  }
}

function horizontalDistance(position: THREE.Vector3, objective: MissionObjective): number {
  return Math.hypot(position.x - objective.x, position.z - objective.z);
}
