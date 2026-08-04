import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { usePathname } from 'next/navigation'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import { WriteUp } from '@/components/screens/write-up'
import type { TicketDetail } from '@/lib/tickets'
import '@/app/globals.css'

const ACTOR_ID = '00000000-0000-4000-8000-000000000100'

function TicketRoute({ ticketId }: { ticketId: string }): React.JSX.Element {
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let canceled = false
    setTicket(null)
    setFailed(false)
    void fetch(`/api/tickets/${ticketId}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || !body.ticket) throw new Error('ticket unavailable')
        if (!canceled) {
          setTicket({
            ...body.ticket,
            createdAt: new Date(body.ticket.createdAt),
            updatedAt: new Date(body.ticket.updatedAt),
            jobs: body.ticket.jobs.map((job: TicketDetail['jobs'][number] & { createdAt: string; updatedAt: string }) => ({
              ...job,
              createdAt: new Date(job.createdAt),
              updatedAt: new Date(job.updatedAt),
            })),
            activities: body.ticket.activities.map((activity: NonNullable<TicketDetail['activities']>[number] & { createdAt: string }) => ({
              ...activity,
              createdAt: new Date(activity.createdAt),
            })),
          })
        }
      })
      .catch(() => { if (!canceled) setFailed(true) })
    return () => { canceled = true }
  }, [ticketId])

  if (failed) return <p role="alert">Repair order fixture unavailable.</p>
  if (!ticket) return <p role="status">Loading deterministic repair-order state…</p>
  return (
    <TicketDetailScreen
      ticket={ticket}
      canCorrectTicket
      currentProfileId={ACTOR_ID}
      currentProfileName="Avery Advisor"
      role="advisor"
      diagnosticsEntitled={false}
    />
  )
}

function Harness(): React.JSX.Element {
  const pathname = usePathname()
  const match = pathname.match(/^\/tickets\/([0-9a-f-]+)$/i)
  if (match) return <TicketRoute ticketId={match[1]} />
  return <WriteUp actorId={ACTOR_ID} userEmail="advisor@loopback.invalid" />
}

const root = document.getElementById('root')
if (!root) throw new Error('ticket correction harness root missing')
createRoot(root).render(<Harness />)
