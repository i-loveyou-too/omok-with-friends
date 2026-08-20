const DECORATIVE_STONES = [
  [2, 2, 'black'],
  [2, 3, 'white'],
  [3, 2, 'white'],
  [3, 3, 'black'],
  [3, 4, 'black'],
  [4, 2, 'black'],
  [4, 3, 'white'],
  [4, 4, 'white'],
] as const

export function HomeBoardDecoration() {
  return (
    <div className="home-board" aria-hidden="true">
      <div className="home-board-grid">
        {Array.from({ length: 49 }, (_, index) => {
          const row = Math.floor(index / 7)
          const col = index % 7
          const stone = DECORATIVE_STONES.find(([stoneRow, stoneCol]) => stoneRow === row && stoneCol === col)
          return <i key={index}>{stone && <b className={`home-stone home-stone--${stone[2]}`} />}</i>
        })}
      </div>
    </div>
  )
}
