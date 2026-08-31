import type { CharacterId } from '../../types'

const base = import.meta.env.BASE_URL

export const curlingStoneAssets: Record<CharacterId, string> = {
  chiikawa: `${base}assets/curling/stones/chiikawa.png`,
  hachiware: `${base}assets/curling/stones/hachiware.png`,
  usagi: `${base}assets/curling/stones/usagi.png`,
  momonga: `${base}assets/curling/stones/momonga.png`,
}

export const curlingConceptAsset = `${base}assets/curling/concept-approved.png`
export const curlingLogoAsset = `${base}assets/curling/logo.png`

// Approved top-view PNGs use a 256px canvas with an approximately 160px physical stone rim.
// 3.2 radii makes that visible rim line up with the server's authoritative 2R collision circle.
export const CURLING_STONE_VISUAL_DIAMETER_IN_RADII = 3.2
