/**
 * Pictures on the dot grid of the heading font, so an icon reads as one more of its letters.
 * To add one, draw it here as seven rows of equal width, a `#` to each dot.
 */
const ICONS = {
  bin: ['...#...', '#######', '.#...#.', '.#.#.#.', '.#.#.#.', '.#...#.', '..###..'],
  undo: ['..#....', '.#.....', '#####..', '.#...#.', '..#...#', '......#', '...###.'],
  heart: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  plus: ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  minus: ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  code: ['...#.#...', '..#...#..', '.#.....#.', '#.......#', '.#.....#.', '..#...#..', '...#.#...'],
} satisfies Record<string, string[]>

export type IconName = keyof typeof ICONS

/** Doto at weight 900 sets square dots 0.09em wide every 0.1em, seven rows to a capital. */
const PITCH = 10
const DOT = 9

/** Sized in ems of the heading, whatever the text beside it. */
export function Icon({ name }: { name: IconName }) {
  const rows = ICONS[name]
  const width = rows[0].length * PITCH
  const height = rows.length * PITCH
  // Each dot sits in the middle of its cell, which keeps the outermost ones clear of the edge.
  const inset = (PITCH - DOT) / 2
  return (
    <svg
      className="icon"
      data-icon={name}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width / 100}em`, height: `${height / 100}em` }}
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((dot, x) => dot === '#' && <rect key={`${x},${y}`} x={x * PITCH + inset} y={y * PITCH + inset} width={DOT} height={DOT} />),
      )}
    </svg>
  )
}
