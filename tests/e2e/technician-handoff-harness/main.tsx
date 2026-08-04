import { createRoot } from 'react-dom/client'
import { TodayJobsBoard } from '@/components/screens/today-jobs-board'
import type { TodayTicketJob } from '@/lib/tickets'
import '@/app/globals.css'
import './style.css'

const TICKET = '00000000-0000-4000-8000-000000000601'
const JOB = '00000000-0000-4000-8000-000000000701'
const ACTOR = '00000000-0000-4000-8000-000000000801'

const baseJob: TodayTicketJob = {
  id: JOB,
  ticketId: TICKET,
  ticketNumber: 804,
  concern: 'Brake vibration under light pedal pressure',
  customerName: 'Marisol Vega',
  vehicle: { year: 2019, make: 'Ford', model: 'F-150' },
  title: 'Replace front brakes and inspect rotors',
  kind: 'maintenance',
  requiredSkillTier: 2,
  sessionId: null,
  workStatus: 'open',
  clockedOnSince: null,
  approvalState: 'approved',
  canClaim: false,
  assignmentState: 'mine',
  assignedTechName: 'Taylor Tech',
  createdByMe: false,
  diagnosticStartErrorCode: null,
  attentionAt: '2026-08-04T15:00:00.000Z',
}

function withIdentity(idSuffix: number, ticketOffset: number, patch: Partial<TodayTicketJob>) {
  return {
    ...baseJob,
    id: `00000000-0000-4000-8000-${idSuffix.toString().padStart(12, '0')}`,
    ticketId: `00000000-0000-4000-8000-${(idSuffix + 100).toString().padStart(12, '0')}`,
    ticketNumber: 804 + ticketOffset,
    ...patch,
  }
}

function jobsFor(pathname: string): { myJobs: TodayTicketJob[]; openJobs: TodayTicketJob[] } {
  if (pathname === '/approved-unassigned' || pathname === '/recovery-race'
    || pathname === '/recovery-replay') {
    return {
      myJobs: [],
      openJobs: [{
        ...baseJob,
        assignmentState: 'unassigned',
        assignedTechName: null,
        canClaim: true,
      }],
    }
  }
  if (pathname === '/state-matrix') {
    return {
      myJobs: [withIdentity(702, 1, {
        approvalState: 'pending_quote',
        title: 'Waiting for advisor price',
      })],
      openJobs: [
        withIdentity(703, 2, {
          assignmentState: 'unassigned', assignedTechName: null, canClaim: false,
          requiredSkillTier: 3, title: 'Requires master-level work',
        }),
        withIdentity(704, 3, {
          assignmentState: 'unassigned', assignedTechName: null, canClaim: false,
          approvalState: 'deferred', title: 'Customer deferred work',
        }),
        withIdentity(705, 4, {
          assignmentState: 'unassigned', assignedTechName: null, canClaim: false,
          approvalState: 'declined', title: 'Customer declined work',
        }),
      ],
    }
  }
  return { myJobs: [baseJob], openJobs: [] }
}

const root = document.getElementById('root')
if (!root) throw new Error('technician handoff harness root missing')
const jobs = jobsFor(window.location.pathname)
createRoot(root).render(
  <main className="technician-handoff-shell">
    <TodayJobsBoard
      myJobs={jobs.myJobs}
      openJobs={jobs.openJobs}
      role="tech"
      currentProfileId={ACTOR}
      diagnosticsEntitled={false}
    />
  </main>,
)
