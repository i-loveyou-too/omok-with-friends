const asset = (path: string) => `${import.meta.env.BASE_URL}assets/yut/${path}`

export const yutAssets = {
  board: asset('board/yut-board-master.png'),
  cardMaster: asset('cards/luck-cards-18-master.png'),
  tiles: {
    normal: asset('ui/tiles/normal.png'),
    lucky: asset('ui/tiles/lucky.png'),
    jackpot: asset('ui/tiles/jackpot.png'),
    event: asset('ui/tiles/event.png'),
    danger: asset('ui/tiles/danger.png'),
  },
  results: {
    backdo: asset('yut/results/do.png'),
    do: asset('yut/results/do.png'),
    gae: asset('yut/results/gae.png'),
    geol: asset('yut/results/geol.png'),
    yut: asset('yut/results/yut.png'),
    mo: asset('yut/results/mo.png'),
  },
  ui: {
    rollButton: asset('ui/roll-button.png'),
    myTurn: asset('ui/my-turn.png'),
    opponentTurn: asset('ui/opponent-turn.png'),
    titleSign: asset('ui/title-sign.png'),
    yutBag: asset('ui/lobby-yut-bag.png'),
    start: asset('ui/badges/start.png'),
    center: asset('ui/badges/center.png'),
    capture: asset('ui/badges/capture.png'),
    stack: asset('ui/badges/stack.png'),
    finish: asset('ui/badges/finish.png'),
  },
  cards: {
    plus_one: asset('cards/01-plus-one.png'),
    plus_two: asset('cards/02-plus-two.png'),
    minus_one: asset('cards/03-minus-one.png'),
    opponent_back: asset('cards/04-opponent-back.png'),
    reroll: asset('cards/05-reroll.png'),
    shield: asset('cards/06-shield.png'),
    merge: asset('cards/07-merge.png'),
    split: asset('cards/08-split-opponent.png'),
    extra_turn: asset('cards/09-extra-turn.png'),
    nothing: asset('cards/10-nothing.png'),
    plus_four: asset('cards/11-plus-four.png'),
    teleport: asset('cards/12-teleport.png'),
    golden_yut: asset('cards/13-golden-yut.png'),
    last_place_boost: asset('cards/14-last-place-boost.png'),
    swap: asset('cards/15-swap.png'),
    minus_three: asset('cards/16-minus-three.png'),
    forced_split: asset('cards/17-forced-split.png'),
    chaos_swap: asset('cards/18-chaos-swap.png'),
  },
} as const

export type YutCardId = keyof typeof yutAssets.cards

export type YutTileKind = keyof typeof yutAssets.tiles

export function yutTileAsset(kind: YutTileKind) {
  return yutAssets.tiles[kind]
}

export function yutResultAsset(name?: string) {
  return name && name in yutAssets.results
    ? yutAssets.results[name as keyof typeof yutAssets.results]
    : null
}

export function yutCardAsset(code?: string) {
  return code && code in yutAssets.cards
    ? yutAssets.cards[code as keyof typeof yutAssets.cards]
    : null
}
