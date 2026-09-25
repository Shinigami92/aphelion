precision highp float;

// The position attribute is the unit vector toward the star at J2000, in
// ICRF equatorial coordinates; the object's own matrix rotates that frame
// into the ecliptic.
attribute vec3 aProperMotion;   // radians per Julian year, tangential
attribute float aMagnitude;     // Johnson V
attribute vec3 aColor;          // sRGB chromaticity, strongest channel full

uniform float uYears;
uniform float uPixelRatio;
uniform float uMagLimit;
uniform float uSizeScale;
uniform float uGain;

varying vec3 vColor;
varying float vSharpness;

#include <aphelion_color>
#include <aphelion_sky_depth>

const float BETA = 2.5;

void main() {
  // Proper motion, on the tangent plane at the star. Over the 900 years
  // the clock covers this is tens of arcminutes for the fastest movers,
  // and renormalising is all the curvature correction that needs.
  vec3 dir = normalize(position + aProperMotion * uYears);

  gl_Position = pinToFarPlane(projectionMatrix * modelViewMatrix * vec4(dir, 1.0));

  // Magnitudes of headroom above the limit, and the flux that implies.
  float headroom = max(uMagLimit - aMagnitude, 0.0);
  float amplitude = uGain * pow(10.0, 0.4 * headroom);

  // Radius, in units of the profile's core width, at which this star
  // fades to the threshold. Solving the Moffat profile for that radius is
  // what ties size to brightness with nothing left to choose.
  float spread = sqrt(max(pow(10.0, 0.4 * headroom / BETA) - 1.0, 0.0));
  float radius = uSizeScale * spread * uPixelRatio;
  float size = clamp(2.0 * radius, uPixelRatio, 64.0 * uPixelRatio);
  gl_PointSize = size;
  vSharpness = spread * spread;

  // A sprite floored to a visible size spreads its light over more pixels
  // than it should; scale the amplitude back so the star still delivers
  // what its magnitude says.
  float floored = 2.0 * radius / size;
  amplitude *= floored * floored;

  // Divide out the stored colour's luminance so hue and brightness stay
  // independent: a red and a blue star of the same V magnitude must put
  // the same amount of light on the screen.
  vec3 chroma = srgbToLinear(aColor);
  float luma = max(dot(chroma, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  vColor = chroma / luma * amplitude;
}
