/**
 * Hand the finished colour to whatever is being drawn into.
 *
 * On screen this does nothing. The scene renders into the composer's
 * half-float target, and Three.js compiles both chunks below to no-ops for
 * any render target, because the composer's OutputPass does the tone mapping
 * and the sRGB encoding once, after bloom.
 *
 * A headset is the exception. Three.js cannot run the composer into a WebXR
 * framebuffer, so in VR each material draws straight into it and has to
 * finish its own colour: ACES and sRGB, exactly what the OutputPass would
 * have applied. Three.js turns both on only for the screen and for XR
 * targets, which is precisely when they are needed.
 */
#include <tonemapping_fragment>
#include <colorspace_fragment>
