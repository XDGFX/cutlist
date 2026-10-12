/**
 * Pictures on the dot grid of the heading font, so an icon reads as one more of its letters.
 * To add one, draw it here as seven rows of equal width, a `#` to each dot; a picture that needs
 * more rows hangs below the baseline.
 */
const ICONS = {
  bin: ['...#...', '#######', '.#...#.', '.#.#.#.', '.#.#.#.', '.#...#.', '..###..'],
  undo: ['..#....', '.#.....', '#####..', '.#...#.', '..#...#', '......#', '...###.'],
  heart: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  plus: ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  minus: ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  sun: ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'],
  moon: ['..###..', '.###...', '###....', '###....', '###....', '.###...', '..###..'],
  /** Two dots taller than a capital, as a round blade needs the room for its teeth to show. */
  blade: ['.....#...', '...####..', '.######..', '###...##.', '.##.#.##.', '.##...###', '..######.', '..####...', '...#.....'],
  /** Four rows, so that it sits close under what it points at. */
  pointer: ['...#...', '..###..', '.#####.', '#######'],
  code: ['...#.#...', '..#...#..', '.#.....#.', '#.......#', '.#.....#.', '..#...#..', '...#.#...'],
} satisfies Record<string, string[]>

export type IconName = keyof typeof ICONS

/** Doto sets a dot every 0.1em, seven rows to a capital. */
const PITCH = 10

/** Sized in ems of the heading, whatever the text beside it. */
export function Icon({ name }: { name: IconName }) {
  const rows = ICONS[name]
  const width = rows[0].length * PITCH
  const height = rows.length * PITCH
  // Dots fill their cells and share one path, so no seam shows between neighbours at any zoom.
  const dots = rows
    .flatMap((row, y) => [...row].map((dot, x) => (dot === '#' ? `M${x * PITCH} ${y * PITCH}h${PITCH}v${PITCH}h${-PITCH}z` : '')))
    .join('')
  return (
    <svg
      className="icon"
      data-icon={name}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width / 100}em`, height: `${height / 100}em` }}
      aria-hidden="true"
    >
      <path d={dots} />
    </svg>
  )
}
