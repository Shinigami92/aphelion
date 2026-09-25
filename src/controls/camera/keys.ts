/** Which camera keys are held down. */

export interface CameraKeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  boost: boolean;
  precise: boolean;
  orbitLeft: boolean;
  orbitRight: boolean;
  orbitUp: boolean;
  orbitDown: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
}

export const emptyKeys = (): CameraKeyState => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  rollLeft: false,
  rollRight: false,
  boost: false,
  precise: false,
  orbitLeft: false,
  orbitRight: false,
  orbitUp: false,
  orbitDown: false,
  zoomIn: false,
  zoomOut: false,
});
