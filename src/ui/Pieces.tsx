import type { Color, PieceType } from "../engine/game";

/**
 * An original piece set drawn on a 45 × 45 grid, styled as neon signs: a dark body with a
 * glowing outline. White's pieces are pale with a bright cyan line, Black's are dark with a
 * magenta line, so the sides read apart by brightness as well as hue. Colors come from CSS
 * custom properties (--w-fill, --w-line, --b-fill, --b-line) so themes can change them.
 */
const BASE = "M10.5 36.5h24a1.5 1.5 0 0 1 1.5 1.5v2.5h-27v-2.5a1.5 1.5 0 0 1 1.5-1.5z";

interface Shape {
  /** Filled body paths. */
  body: string[];
  /** Detail lines drawn in the contrasting color. */
  detail?: string[];
  /** Small filled circles: [cx, cy, r]. */
  dots?: [number, number, number][];
  /** Small circles in the contrasting color (the knight's eye). */
  marks?: [number, number, number][];
}

const SHAPES: Record<PieceType, Shape> = {
  p: {
    body: [
      "M16 36.5c0-6 2.2-10.5 4.6-12.4h3.8c2.4 1.9 4.6 6.4 4.6 12.4z",
      "M17.5 24.6h10a1.4 1.4 0 0 0 0-2.8h-10a1.4 1.4 0 0 0 0 2.8z",
      BASE,
    ],
    dots: [[22.5, 15.5, 5.6]],
  },
  r: {
    body: [
      "M12.5 9h4.2v3.4h3.6V9h4.4v3.4h3.6V9h4.2v8.2h-20z",
      "M15 17.2h15l-.6 15.3H15.6z",
      "M13.5 32.5h18l1.5 4h-21z",
      BASE,
    ],
    detail: ["M15.2 21h14.6", "M15.6 28.6h13.8"],
  },
  n: {
    body: [
      "M32.5 36.5H14.2c-.4-5.5 2.4-8.9 6-11.6-3 .4-5.5 1.6-7.6 1.2-2.3-.5-3.4-2.6-2.4-4.8l7.4-9.6c.7-2.4 2.3-4.2 4.4-4.9l.4-3.3 2.6 3.7c6.2 1.8 9.8 7.7 9.6 16-.2 5.8-1.5 9.6-2.1 13.3z",
      BASE,
    ],
    detail: ["M26.4 12.6c3.4 2.4 5 6.6 4.6 12.6", "M12.6 22.8h1.6"],
    marks: [[19.6, 14.6, 1.5]],
  },
  b: {
    body: [
      "M22.5 9.4c-5.4 4.6-7.5 10.4-6 15.6h12c1.5-5.2-.6-11-6-15.6z",
      "M16.3 25h12.4v3.2H16.3z",
      "M17.4 28.2c-.2 3.8-1.7 6-3.4 8.3h17c-1.7-2.3-3.2-4.5-3.4-8.3z",
      BASE,
    ],
    detail: ["M25.3 14.2l-4.6 5.8"],
    dots: [[22.5, 7.2, 2.3]],
  },
  q: {
    body: [
      "M14.2 30.2L10 15.5l4.8 6.3 1.6-10.2 3.4 8.6 2.7-10.4 2.7 10.4 3.4-8.6 1.6 10.2 4.8-6.3-4.2 14.7z",
      "M14 30.2h17v3.4H14z",
      "M13.4 33.6h18.2l1.4 2.9H12z",
      BASE,
    ],
    detail: ["M15.6 26.4h13.8"],
    dots: [
      [10, 14.6, 2],
      [16.4, 10.6, 2],
      [22.5, 8.2, 2.1],
      [28.6, 10.6, 2],
      [35, 14.6, 2],
    ],
  },
  k: {
    body: [
      "M21.4 3.2h2.2v3.2h3.2v2.2h-3.2v4.2h-2.2V8.6h-3.2V6.4h3.2z",
      "M13.6 30.6c-3.6-6.6-2.8-14 3.6-14.6 3-.3 4.6 2 5.3 4.4.7-2.4 2.3-4.7 5.3-4.4 6.4.6 7.2 8 3.6 14.6z",
      "M13.6 30.6h17.8v3H13.6z",
      "M13.2 33.6h18.6l1.2 2.9H12z",
      BASE,
    ],
    detail: ["M22.5 20.6v9.4", "M15.8 26.8h13.4"],
  },
};

export function PieceIcon({
  type,
  color,
  size,
  className,
}: {
  type: PieceType;
  color: Color;
  size?: number | string;
  className?: string;
}) {
  const shape = SHAPES[type];
  const fill = `var(--${color}-fill)`;
  const line = `var(--${color}-line)`;
  return (
    <svg
      viewBox="0 0 45 45"
      width={size}
      height={size}
      className={`piece-svg piece-svg--${color} ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill={fill} stroke={line} strokeWidth={1.6} strokeLinejoin="round">
        {shape.body.map((d, i) => (
          <path key={i} d={d} />
        ))}
        {shape.dots?.map(([cx, cy, r], i) => (
          <circle key={`d${i}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      {shape.detail && (
        <g fill="none" stroke={line} strokeWidth={1.3} strokeLinecap="round">
          {shape.detail.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
      {shape.marks?.map(([cx, cy, r], i) => (
        <circle key={`m${i}`} cx={cx} cy={cy} r={r} fill={line} />
      ))}
    </svg>
  );
}
