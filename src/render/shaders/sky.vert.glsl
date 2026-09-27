varying vec2 vUv;
#include <aphelion_sky_depth>
void main() {
  vUv = uv;
  // w = 0 makes this a direction: the translation drops out of the view
  // matrix, so the sky sits at infinity for each eye on its own. See star.vert.
  gl_Position = pinToFarPlane(projectionMatrix * modelViewMatrix * vec4(position, 0.0));
}
