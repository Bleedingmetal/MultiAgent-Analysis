/**
 * Static page wash — soft navy gradient, no animation, no pointer reaction.
 */
export function BackgroundField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          "radial-gradient(1200px 700px at 12% -10%, rgba(2, 101, 255, 0.06), transparent 55%), radial-gradient(900px 600px at 100% 0%, rgba(0, 46, 107, 0.05), transparent 50%), #eef2f7",
      }}
    />
  )
}
