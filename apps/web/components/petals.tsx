/**
 * Fixed, non-interactive background of small lavender petals. Positions are a
 * hard-coded list (not random) so server and client markup always match.
 * Drift is paused for `prefers-reduced-motion` in globals.css.
 */
const PETALS: Array<{ x: number; y: number; s: number; r: number; o: number; blur?: number; d: number }> = [
  { x: 6, y: 12, s: 26, r: 20, o: 0.2, d: 0 },
  { x: 18, y: 64, s: 14, r: -35, o: 0.15, blur: 1, d: -6 },
  { x: 31, y: 28, s: 10, r: 70, o: 0.18, d: -12 },
  { x: 44, y: 82, s: 34, r: 10, o: 0.12, blur: 3, d: -3 },
  { x: 58, y: 8, s: 18, r: -60, o: 0.2, d: -9 },
  { x: 71, y: 52, s: 12, r: 40, o: 0.16, d: -15 },
  { x: 83, y: 22, s: 28, r: -15, o: 0.14, blur: 2, d: -4 },
  { x: 92, y: 74, s: 16, r: 55, o: 0.22, d: -11 },
  { x: 52, y: 46, s: 9, r: -80, o: 0.18, d: -18 },
  { x: 12, y: 90, s: 22, r: 30, o: 0.13, blur: 2, d: -7 },
];

export function Petals() {
  return (
    <div className="petals" aria-hidden="true">
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={
            {
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.s,
              height: p.s,
              opacity: p.o + 0.1,
              filter: p.blur ? `blur(${p.blur}px)` : undefined,
              animationDelay: `${p.d}s`,
              "--r": `${p.r}deg`,
              transform: `rotate(${p.r}deg)`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
