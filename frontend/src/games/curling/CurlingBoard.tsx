import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CharacterId } from '../../types'
import { CURLING_STONE_VISUAL_DIAMETER_IN_RADII, curlingStoneAssets } from './assets'
import { CurlingStone } from './CurlingStone'
import type {
  CurlDirection,
  CurlingPlayer,
  CurlingShotFrame,
  CurlingShotResolved,
  CurlingState,
  CurlingStoneState,
} from './types'

const MAX_PULL = 190
const MIN_POWER = 0.16
const MAX_ANGLE = 28

interface Props {
  state: CurlingState
  selfId: string | null
  shot: CurlingShotResolved | null
  shotNonce: number
  liveFrame: CurlingShotFrame | null
  canShoot: boolean
  canSweep: boolean
  sweepActive: boolean
  onShoot: (angle: number, power: number, curl: CurlDirection) => boolean
  onSweep: (active: boolean) => void
  onAnimatingChange?: (animating: boolean) => void
  onFeedbackChange?: (active: boolean) => void
}

interface AimState {
  pointerId: number
  anchorX: number
  anchorY: number
  pullX: number
  pullY: number
  angle: number
  power: number
}

interface ShotEffect {
  label: string
  detail?: string
  tone: 'perfect' | 'impact' | 'tap' | 'score' | 'out'
}

function playerById(players: CurlingPlayer[], id: string) {
  return players.find((player) => player.id === id)
}

function characterFor(players: CurlingPlayer[], id: string): CharacterId {
  return playerById(players, id)?.character ?? 'chiikawa'
}

function effectForShot(shot: CurlingShotResolved, shootout: boolean): ShotEffect | null {
  if (shot.out) return { label: shootout ? 'MISS!' : '앗! OUT', detail: '빙판 밖으로 나갔어', tone: 'out' }
  if (shootout && shot.distanceToButton !== null) {
    return {
      label: shot.distanceToButton <= 45 ? 'BUTTON!' : `기록 ${Math.round(shot.distanceToButton)}`,
      detail: '중앙 거리',
      tone: shot.distanceToButton <= 45 ? 'perfect' : 'score',
    }
  }
  if (shot.perfect || shot.landingPoints === 50) return { label: 'PERFECT!', detail: '+50', tone: 'perfect' }
  if (shot.opponentTakeoutCount > 0) return { label: '쾅!!', detail: `TAKE OUT ×${shot.opponentTakeoutCount}`, tone: 'impact' }
  if (shot.impactCount > 0 && shot.maxImpactSpeed >= 260) return { label: '쾅!!', detail: '강한 충돌!', tone: 'impact' }
  if (shot.impactCount > 0) return { label: '톡!', tone: 'tap' }
  if (shot.landingPoints > 0) return { label: `+${shot.landingPoints}`, detail: '점수 존 안착!', tone: 'score' }
  return null
}

export function CurlingBoard({
  state,
  selfId,
  shot,
  shotNonce,
  liveFrame,
  canShoot,
  canSweep,
  sweepActive,
  onShoot,
  onSweep,
  onAnimatingChange,
  onFeedbackChange,
}: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const animationTimerRef = useRef<number | undefined>(undefined)
  const effectTimerRef = useRef<number | undefined>(undefined)
  const sweepHeldRef = useRef(false)
  const aimRef = useRef<AimState | null>(null)
  const [aim, setAim] = useState<AimState | null>(null)
  const [curl, setCurl] = useState<CurlDirection>('straight')
  const [animatedStones, setAnimatedStones] = useState<CurlingStoneState[] | null>(null)
  const [animating, setAnimating] = useState(false)
  const [shotEffect, setShotEffect] = useState<ShotEffect | null>(null)
  const [launchPending, setLaunchPending] = useState(false)

  const { house } = state
  const selfCharacter = selfId ? characterFor(state.players, selfId) : 'chiikawa'
  const stonePoints = state.lastEndResult?.stonePoints ?? {}
  const scoringIds = useMemo(
    () => new Set(state.lastEndResult?.scoringStoneIds ?? []),
    [state.lastEndResult?.scoringStoneIds],
  )
  const scoreRings = useMemo(
    () => [...house.scoreRings].sort((a, b) => b.radius - a.radius),
    [house.scoreRings],
  )

  useEffect(() => {
    if (!shot || !shot.frames.length) return
    if (animationTimerRef.current) window.clearInterval(animationTimerRef.current)
    let index = 0
    setAnimating(true)
    onAnimatingChange?.(true)
    setAnimatedStones(shot.frames[0])
    animationTimerRef.current = window.setInterval(() => {
      index += 1
      if (index >= shot.frames.length) {
        if (animationTimerRef.current) window.clearInterval(animationTimerRef.current)
        animationTimerRef.current = undefined
        setAnimatedStones(null)
        setAnimating(false)
        onAnimatingChange?.(false)
        return
      }
      setAnimatedStones(shot.frames[index])
    }, 48)
    return () => {
      if (animationTimerRef.current) window.clearInterval(animationTimerRef.current)
      animationTimerRef.current = undefined
      setAnimatedStones(null)
      setAnimating(false)
      onAnimatingChange?.(false)
    }
  }, [shotNonce])

  useEffect(() => {
    if (!shot) return
    const effect = effectForShot(shot, state.status === 'shootout' || state.lastEndResult?.kind === 'shootout')
    const holdMs = effect ? 1250 : 480
    setShotEffect(effect)
    onFeedbackChange?.(true)
    if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current)
    effectTimerRef.current = window.setTimeout(() => {
      setShotEffect(null)
      onFeedbackChange?.(false)
    }, holdMs)
    return () => {
      if (effectTimerRef.current) window.clearTimeout(effectTimerRef.current)
      effectTimerRef.current = undefined
      onFeedbackChange?.(false)
    }
  }, [shotNonce])

  useEffect(() => {
    if (state.shotInProgress) {
      onAnimatingChange?.(true)
    } else if (!animating) {
      onAnimatingChange?.(false)
    }
  }, [animating, onAnimatingChange, state.shotInProgress])

  useEffect(() => {
    if (!canShoot) {
      aimRef.current = null
      setAim(null)
    }
  }, [canShoot])

  useEffect(() => {
    if (state.shotInProgress || !canShoot) setLaunchPending(false)
  }, [canShoot, state.shotInProgress])

  useEffect(() => {
    if (!canSweep && sweepHeldRef.current) {
      sweepHeldRef.current = false
      onSweep(false)
    }
  }, [canSweep, onSweep])

  useEffect(() => () => {
    if (sweepHeldRef.current) onSweep(false)
  }, [onSweep])

  const startSweep = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canSweep || sweepHeldRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sweepHeldRef.current = true
    onSweep(true)
  }

  const stopSweep = () => {
    if (!sweepHeldRef.current) return
    sweepHeldRef.current = false
    onSweep(false)
  }

  const boardPoint = (event: ReactPointerEvent) => {
    const element = boardRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * house.rinkWidth,
      y: ((event.clientY - rect.top) / rect.height) * house.rinkHeight,
    }
  }

  const aimFromDrag = (dx: number, dy: number) => {
    const backward = Math.max(0, dy)
    if (backward < 2) return { angle: 0, power: 0, pullX: 0, pullY: 0 }

    // Power must come from actually pulling backward. A mostly-horizontal
    // swipe should never turn into a surprise max-power shot.
    const maxLateral = Math.tan(MAX_ANGLE * Math.PI / 180) * backward
    const lateral = Math.max(-maxLateral, Math.min(maxLateral, dx))
    const rawPull = Math.min(MAX_PULL, Math.hypot(lateral, backward))
    const rawAngle = Math.atan2(-lateral, backward) * (180 / Math.PI)
    const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, rawAngle))
    const angleRad = angle * Math.PI / 180
    return {
      angle,
      power: Math.min(1, rawPull / MAX_PULL),
      // The stone is pulled opposite the direction it will travel.
      pullX: -Math.sin(angleRad) * rawPull,
      pullY: Math.cos(angleRad) * rawPull,
    }
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canShoot || animating || launchPending) return
    const point = boardPoint(event)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const nextAim = {
      pointerId: event.pointerId,
      anchorX: point.x,
      anchorY: point.y,
      pullX: 0,
      pullY: 0,
      angle: 0,
      power: 0,
    }
    aimRef.current = nextAim
    setAim(nextAim)
  }

  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const currentAim = aimRef.current
    if (!currentAim || currentAim.pointerId !== event.pointerId) return
    const point = boardPoint(event)
    if (!point) return
    const next = aimFromDrag(point.x - currentAim.anchorX, point.y - currentAim.anchorY)
    const nextAim = { ...currentAim, ...next }
    aimRef.current = nextAim
    setAim(nextAim)
  }

  const finishAim = () => {
    const finalAim = aimRef.current
    if (!finalAim) return
    aimRef.current = null
    setAim(null)
    if (finalAim.power >= MIN_POWER) {
      const sent = onShoot(finalAim.angle, finalAim.power, curl)
      if (sent) {
        setLaunchPending(true)
        setCurl('straight')
      }
    }
  }

  const release = (event: ReactPointerEvent<HTMLElement>) => {
    if (aimRef.current?.pointerId !== event.pointerId) return
    finishAim()
  }

  const displayStones = liveFrame ?? animatedStones ?? state.stones
  const motionActive = state.shotInProgress || animating || Boolean(liveFrame)
  const aimRadians = aim ? aim.angle * Math.PI / 180 : 0
  const guideLength = aim ? 250 + aim.power * 390 : 0
  const guideX = house.startX + Math.sin(aimRadians) * guideLength
  const guideY = house.startY - Math.cos(aimRadians) * guideLength
  const curlShift = aim
    ? (curl === 'left' ? -1 : curl === 'right' ? 1 : 0) * (28 + 62 * aim.power)
    : 0
  const controlX = (house.startX + guideX) / 2 + curlShift
  const controlY = (house.startY + guideY) / 2
  const launchX = house.startX + (aim?.pullX ?? 0)
  const launchY = house.startY + (aim?.pullY ?? 0)

  return (
    <div
      className="curling-board-wrap"
      onPointerMove={pointerMove}
      onPointerUp={release}
      onMouseUp={finishAim}
    >
      <div className="curling-score-legend" aria-label="점수 존">
        {house.scoreRings.map((ring) => <span key={ring.points}><b>{ring.points}</b>점</span>)}
        <small>스톤 중심 기준</small>
      </div>

      <div className="curling-curl-control" aria-label="스톤 회전 선택">
        <button type="button" className={curl === 'left' ? 'is-selected' : ''} disabled={!canShoot || animating} onClick={() => setCurl('left')}>↶ <span>왼쪽</span></button>
        <button type="button" className={curl === 'straight' ? 'is-selected' : ''} disabled={!canShoot || animating} onClick={() => setCurl('straight')}>↑ <span>직진</span></button>
        <button type="button" className={curl === 'right' ? 'is-selected' : ''} disabled={!canShoot || animating} onClick={() => setCurl('right')}>↷ <span>오른쪽</span></button>
      </div>

      <div
        ref={boardRef}
        className={`curling-board ${motionActive ? 'is-animating' : ''} ${aim ? 'is-aiming' : ''}`}
        style={{ aspectRatio: `${house.rinkWidth} / ${house.rinkHeight}` }}
      >
        <div className="curling-rink-lines" aria-hidden="true">
          <span className="curling-hog curling-hog--far" />
          <span className="curling-hog curling-hog--near" />
          <span className="curling-center-line" />
        </div>

        <div
          className="curling-house"
          aria-label="하우스"
          style={{
            left: `${house.x / house.rinkWidth * 100}%`,
            top: `${house.y / house.rinkHeight * 100}%`,
            width: `${house.radius * 2 / house.rinkWidth * 100}%`,
          }}
        >
          {scoreRings.map((ring) => (
            <span
              key={ring.points}
              className={`curling-house__score-ring curling-house__score-ring--${ring.points}`}
              style={{ width: `${ring.radius / house.radius * 100}%` }}
            >
              <b>{ring.points}</b>
            </span>
          ))}
          <i className="curling-house__crosshair curling-house__crosshair--x" />
          <i className="curling-house__crosshair curling-house__crosshair--y" />
        </div>

        <svg className="curling-aim-layer" viewBox={`0 0 ${house.rinkWidth} ${house.rinkHeight}`} aria-hidden="true">
          {aim && (
            <>
              <path
                className={`curling-aim-line curling-aim-line--${curl}`}
                d={`M ${house.startX} ${house.startY} Q ${controlX} ${controlY} ${guideX} ${guideY}`}
              />
              <circle className="curling-aim-dot" cx={guideX} cy={guideY} r="11" />
            </>
          )}
        </svg>

        {displayStones.map((stone) => (
          <CurlingStone
            key={stone.id}
            stone={stone}
            character={characterFor(state.players, stone.ownerId)}
            rinkWidth={house.rinkWidth}
            rinkHeight={house.rinkHeight}
            stoneRadius={house.stoneRadius}
            self={stone.ownerId === selfId}
            scoring={scoringIds.has(stone.id)}
            points={state.status === 'end_finished' ? (stonePoints[stone.id] ?? 0) : 0}
          />
        ))}

        {canShoot && !animating && !launchPending && (
          <button
            className={`curling-launch-stone ${aim ? 'is-aiming' : ''}`}
            type="button"
            aria-label="현재 스톤을 뒤로 당겨서 조준"
            style={{
              left: `${launchX / house.rinkWidth * 100}%`,
              top: `${launchY / house.rinkHeight * 100}%`,
              width: `${house.stoneRadius * CURLING_STONE_VISUAL_DIAMETER_IN_RADII / house.rinkWidth * 100}%`,
            }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={release}
            onMouseUp={finishAim}
            onPointerCancel={() => {
              aimRef.current = null
              setAim(null)
            }}
          >
            <span className="curling-launch-stone__face curling-launch-stone__face--asset">
              <img src={curlingStoneAssets[selfCharacter]} alt="" draggable={false} />
              <b>{aim ? '손 떼면 쓩!' : curl === 'left' ? '↶' : curl === 'right' ? '↷' : '쓩!'}</b>
            </span>
          </button>
        )}

        {aim && (
          <div className="curling-power" aria-live="polite">
            <span style={{ width: `${aim.power * 100}%` }} />
            <b>{aim.power < MIN_POWER ? '조금 더 당겨줘!' : `POWER ${Math.round(aim.power * 100)}`}</b>
          </div>
        )}

        {shotEffect && (
          <div className={`curling-shot-effect curling-shot-effect--${shotEffect.tone}`} key={`${shotNonce}-${shotEffect.label}`}>
            <b>{shotEffect.label}</b>
            {shotEffect.detail && <span>{shotEffect.detail}</span>}
          </div>
        )}
      </div>

      <div className={`curling-sweep-panel ${sweepActive ? 'is-sweeping' : ''}`}>
        <button
          type="button"
          disabled={!canSweep}
          onPointerDown={startSweep}
          onPointerUp={stopSweep}
          onPointerCancel={stopSweep}
          onLostPointerCapture={stopSweep}
          onKeyDown={(event) => {
            if ((event.key === ' ' || event.key === 'Enter') && canSweep && !sweepHeldRef.current) {
              sweepHeldRef.current = true
              onSweep(true)
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') stopSweep()
          }}
        >
          <span>🧹</span>
          <b>{sweepActive ? '싹싹싹!!' : '싹싹!'}</b>
          <small>{canSweep ? '누르면 더 멀리 + 더 곧게!' : state.shotInProgress ? '상대 스톤 이동 중' : '던진 다음 사용할 수 있어'}</small>
        </button>
      </div>
    </div>
  )
}
