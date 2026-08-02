'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TodayTicketJobs } from '@/lib/tickets'
import { parseTodayJobsResponse } from '@/lib/shop-os/today-board'
import { floorLayout, projectFloorBoard, type FloorLane } from '@/lib/shop-os/floor-board'
import { formatAttentionClock } from '@/lib/shop-os/attention-clock'
import styles from './floor-board.module.css'

type Props = {
  shopName: string | null
  todayJobs: TodayTicketJobs
  /** Test seam. Production leaves this at the twenty-second default. */
  refreshMs?: number
}

const REFRESH_MS = 20_000
const CLOCK_MS = 15_000

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function FloorBoard({ shopName, todayJobs, refreshMs = REFRESH_MS }: Props) {
  const [jobs, setJobs] = useState<TodayTicketJobs>(todayJobs)
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    setJobs(todayJobs)
  }, [todayJobs])

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/today/jobs', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const body: unknown = await response.json().catch(() => null)
      const fresh = response.ok ? parseTodayJobsResponse(body) : null
      // A malformed or failed poll leaves the wall showing the last true board.
      // Nobody is standing at this screen to retry it.
      if (fresh) setJobs(fresh)
    } catch {
      // Same reason: a dropped shop wifi packet must not blank the wall.
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => { void refresh() }, refreshMs)
    return () => { window.clearInterval(interval) }
  }, [refresh, refreshMs])

  useEffect(() => {
    const tick = () => { setNowMs(Date.now()) }
    tick()
    const interval = window.setInterval(tick, CLOCK_MS)
    return () => { window.clearInterval(interval) }
  }, [])

  const board = useMemo(() => projectFloorBoard(jobs), [jobs])
  const layout = useMemo(() => floorLayout(board), [board])
  const clock = nowMs === null ? '' : formatClock(new Date(nowMs))

  return (
    <main
      className={styles.floor}
      data-dense={board.dense}
      style={{
        // One shared row height across every lane, so the type scale is a
        // single number rather than a per-lane measurement pass.
        '--floor-weight': Math.max(layout.weight, 1),
        '--floor-empty': layout.emptyLanes,
        gridTemplateRows: 'auto 1fr',
      } as React.CSSProperties}
    >
      <header className={styles.masthead}>
        <h1 className={styles.shop}>{shopName ?? 'Shop floor'}</h1>
        <p className={styles.count}>
          <span className={styles.countNumber}>{board.vehicleCount}</span>
          <span className={styles.countWord}>
            {board.vehicleCount === 1 ? 'vehicle in the building' : 'vehicles in the building'}
          </span>
        </p>
        <p className={styles.clock}>{clock}</p>
      </header>

      {board.vehicleCount === 0 ? (
        <p className={styles.quiet}>No open work</p>
      ) : (
        <div className={styles.lanes} style={{ gridTemplateRows: layout.tracks }}>
          {board.lanes.map((lane) => (
            <Lane key={lane.id} lane={lane} dense={board.dense} nowMs={nowMs} />
          ))}
        </div>
      )}
    </main>
  )
}

function Lane({
  lane,
  dense,
  nowMs,
}: {
  lane: FloorLane
  dense: boolean
  nowMs: number | null
}) {
  return (
    <section className={styles.lane} data-lane={lane.id} data-empty={lane.total === 0}>
      <div className={styles.spine} aria-hidden="true" />
      <h2 className={styles.laneLabel}>
        {lane.label}
        <span className={styles.laneCount}>{lane.total === 0 ? '—' : lane.total}</span>
      </h2>
      <div className={styles.rows}>
        {lane.rows.map((row) => {
          const attention = nowMs === null
            ? null
            : formatAttentionClock(row.attentionAt, nowMs)
          return (
            <div className={styles.row} key={row.key} data-ticket-id={row.key}>
              <span className={styles.ticket}>{String(row.ticketNumber).padStart(4, '0')}</span>
              <span className={styles.subject}>
                <span className={styles.vehicle}>{row.vehicle}</span>
                <span className={styles.customer}>{row.customer}</span>
                {dense ? null : <span className={styles.concern}>{row.concern}</span>}
              </span>
              <span className={styles.right}>
                <span>{row.right}</span>
                {attention && (
                  <span className={styles.attention} data-attention={attention.tier}>
                    {attention.label}
                  </span>
                )}
              </span>
            </div>
          )
        })}
        {lane.overflow > 0 ? (
          <div className={styles.tail}>{`+${lane.overflow} more`}</div>
        ) : null}
      </div>
    </section>
  )
}
