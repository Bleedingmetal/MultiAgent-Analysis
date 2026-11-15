/**
 * Static page wash: a soft navy gradient over the theme's background, no animation,
 * no pointer reaction. Styled in globals.css (.page-wash) so the server and client
 * render the same markup.
 */
export function BackgroundField() {
  return <div aria-hidden className="page-wash pointer-events-none fixed inset-0 z-0" />
}
