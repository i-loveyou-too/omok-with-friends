const asset = (path: string) => `assets/yut/${path}`

export const yutAssets = {
  board: asset('board/yut-board-master.png'),
  yutReference: asset('yut/yut-sticks-reference.png'),
  specialTilesReference: asset('ui/special-tiles-reference.png'),
  cardMaster: asset('cards/luck-cards-18-master.png'),
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
  ui: {
    gameUiReference: asset('ui/game-ui-reference.png'),
    eventBadges: asset('ui/event-badges.png'),
    turnAndRollButtons: asset('ui/turn-and-roll-buttons.png'),
    titleAndYutBag: asset('ui/title-and-yut-bag.png'),
  },
} as const
