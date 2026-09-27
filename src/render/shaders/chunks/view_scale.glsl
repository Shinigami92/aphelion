/**
 * Scene units per view-space unit.
 *
 * On screen the view matrix is a pure rotation and translation, so this is 1.
 * In VR the headset hangs off a rig scaled so that a metre of head movement
 * spans the right amount of scene (see render/scene/xr-rig.ts), and that scale
 * lands in the view matrix. Anything sized by its view-space distance divides
 * by this to get the true distance back, or every point would change size
 * with the rig.
 */
float sceneUnitsPerViewUnit() {
  return 1.0 / length(viewMatrix[0].xyz);
}
