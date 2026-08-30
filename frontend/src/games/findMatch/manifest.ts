const base = import.meta.env.BASE_URL

export const DIFFICULTIES = {
  easy: { label: '쉬움', count: 8 },
  medium: { label: '보통', count: 10 },
  hard: { label: '어려움', count: 12 },
} as const

export type FindMatchDifficulty = keyof typeof DIFFICULTIES

const symbolAsset = (name: string) => `${base}assets/find-match/symbols/${name}.png`
const characterAsset = (name: string) => `${base}assets/find-match/characters/${name}.png`

const characterPrefixes = ['chiikawa', 'hachiware', 'usagi', 'momonga'] as const
const characterIds = characterPrefixes.flatMap((name) => [1, 2, 3, 4].map((number) => `${name}_${String(number).padStart(2, '0')}`))
const symbolIds = [
  'pudding', 'strawberry_cake', 'cream_soda', 'ice_cream', 'donut', 'hotcake',
  'melon_bread', 'roll_cake', 'star_candy', 'rice_ball', 'omurice', 'curry',
  'spicy_curry', 'ramen', 'udon', 'dumpling', 'takoyaki', 'fried_egg',
  'octopus_sausage', 'sandwich', 'hamburger', 'fries', 'pizza', 'cupcake',
  'sweet_potato', 'corn', 'gimbap', 'cheese', 'milk', 'juice', 'macaron',
  'camera', 'subjugation_fork', 'teddy_bear', 'star', 'pink_bear_pochette',
  'acorn', 'ribbon', 'heart', 'clover', 'flower', 'mushroom', 'umbrella',
  'teacup', 'mug', 'gift_box', 'bell', 'hat', 'pencil', 'notebook',
  'binoculars', 'doll', 'chocolate', 'magnifier',
] as const
const trapIds = [
  'trap_pudding_plain', 'trap_pudding_cherry', 'trap_star_round', 'trap_star_pointy',
  'trap_camera_left_lens', 'trap_camera_right_lens', 'trap_acorn_short_cap', 'trap_acorn_tall_cap',
  'trap_pochette_round_ear', 'trap_pochette_pointed_ear', 'trap_umbrella_blue', 'trap_umbrella_pink',
  'trap_mushroom_five_spots', 'trap_mushroom_six_spots', 'trap_ribbon_round', 'trap_ribbon_square',
  'trap_mug_plain', 'trap_mug_straw', 'trap_melon_bread_grid_a', 'trap_melon_bread_grid_b',
  'trap_cream_soda_cherry_left', 'trap_cream_soda_cherry_right',
  'trap_roll_cake_swirl_left', 'trap_roll_cake_swirl_right', 'trap_heart_plain',
  'trap_heart_sparkle', 'trap_flower_white', 'trap_flower_pink', 'trap_chocolate_plain',
  'trap_chocolate_wrapped',
] as const

const SOURCES: Record<string, string> = Object.fromEntries([
  ...symbolIds.map((id) => [id, symbolAsset(id)]),
  ...trapIds.map((id) => [id, symbolAsset(id)]),
  ...characterIds.map((id) => [id, characterAsset(id)]),
])

export function symbolSrc(id: string) {
  return SOURCES[id] ?? ''
}

export function findMatchCharacterSrc(character: string, pose = 1) {
  const safePose = Math.min(4, Math.max(1, pose))
  return characterAsset(`${character}_${String(safePose).padStart(2, '0')}`)
}

export const findMatchAsset = (name: 'magnifier' | 'hero') => name === 'hero'
  ? characterAsset('hachiware_03')
  : symbolAsset('magnifier')
