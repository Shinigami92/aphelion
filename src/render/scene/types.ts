/** The scene's public settings, as the UI reads and writes them. */

export type Quality = 'low' | 'medium' | 'high';
export type OrbitMode = 'none' | 'planets' | 'all';
export type LabelMode = 'none' | 'major' | 'all';

export interface SceneToggles {
  orbits: OrbitMode;
  labels: LabelMode;
  belts: boolean;
  rings: boolean;
  atmospheres: boolean;
  milkyway: boolean;
  minorBodies: boolean;
  lagrange: boolean;
}
