/**
 * sRGB decode. We deliberately mark every texture as linear so Three.js does
 * not inject its own conversion into these custom shaders, then decode here.
 * That keeps the colour pipeline explicit instead of depending on which
 * material type is in use.
 */
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
