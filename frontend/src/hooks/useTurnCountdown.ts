import { useEffect, useRef, useState } from 'react'

export function useTurnCountdown(deadline: number | null | undefined, serverNow: number | undefined) {
  const offsetRef = useRef(0)
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    if (serverNow !== undefined) {
      offsetRef.current = serverNow - Date.now()
      setClock(Date.now())
    }
  }, [serverNow])

  useEffect(() => {
    if (!deadline) return
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [deadline])

  if (!deadline) return null
  return Math.max(0, Math.ceil((deadline - (clock + offsetRef.current)) / 1000))
}
