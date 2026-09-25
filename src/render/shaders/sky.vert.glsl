varying vec2 vUv;
#include <aphelion_sky_depth>
void main() {
  vUv = uv;
  gl_Position = pinToFarPlane(projectionMatrix * modelViewMatrix * vec4(position, 1.0));
}
