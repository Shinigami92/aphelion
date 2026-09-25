/**
 * Put a vertex on the far plane, whatever its actual distance.
 *
 * Setting clip-space z equal to w lands the vertex exactly on the far plane, so
 * the depth test resolves the sky behind literally everything without the
 * radius of the sky sphere having to mean anything. That matters here more than
 * in an ordinary scene: Aphelion recomputes its near and far planes every frame
 * from how much space is in front of the camera, and they range over eleven
 * orders of magnitude. Any fixed radius is inside the near plane at one focus
 * and beyond the far plane at another — the previous backdrop sat at 1e8 units,
 * which is outside the far plane for most views.
 *
 * It also removes the near plane from the argument: clipping tests -w <= z <= w,
 * and z = w satisfies both, so the only vertices that go are the ones genuinely
 * behind the eye. Depth *writing* stays off, so the sky never occludes anything
 * that is drawn afterwards.
 *
 * The 1e-6 backs off the exact boundary, where some drivers round the wrong way
 * and drop the fragment.
 */
vec4 pinToFarPlane(vec4 clip) {
  return vec4(clip.xy, clip.w * (1.0 - 1e-6), clip.w);
}
