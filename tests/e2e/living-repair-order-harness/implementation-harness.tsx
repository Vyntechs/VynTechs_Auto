import { useEffect } from 'react'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import type { TicketDetail } from '@/lib/tickets'
import type { PartsArrivalJobView } from '@/lib/shop-os/parts-arrival-ui'
import '@/components/vt/vt.css'
import {
  IMPLEMENTATION_JOB_ID,
  IMPLEMENTATION_SECOND_JOB_ID,
  IMPLEMENTATION_TECH_ID,
  IMPLEMENTATION_TICKET_ID,
} from './implementation-constants'

const profileIds = {
  tech: IMPLEMENTATION_TECH_ID,
  advisor: '00000000-0000-4000-8000-000000003002',
  parts: '00000000-0000-4000-8000-000000003003',
  owner: '00000000-0000-4000-8000-000000003004',
} as const

type ProofRole = keyof typeof profileIds

const otherTechnician = {
  id: '00000000-0000-4000-8000-000000003005',
  fullName: 'Riley Technician',
  role: 'tech' as const,
  skillTier: 3,
}

function proofJob(
  id: string,
  title: string,
  assignedTech = {
    id: IMPLEMENTATION_TECH_ID,
    fullName: 'Toni Technician',
    role: 'tech' as const,
    skillTier: 3,
  },
): TicketDetail['jobs'][number] {
  const timestamp = new Date('2026-08-05T14:30:00.000Z')
  return {
    id,
    title,
    kind: 'repair',
    requiredSkillTier: 2,
    assignedTechId: assignedTech.id,
    assignedTech,
    sessionId: null,
    workStatus: 'open',
    approvalState: 'pending_quote',
    customerSuppliedPartsNote: null,
    workNotes: null,
    diagnosticStartState: 'idle',
    diagnosticStartErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function proofTicket(state: string | null): TicketDetail {
  const timestamp = new Date('2026-08-05T14:30:00.000Z')
  const partsMode = state?.startsWith('parts-') === true
  const primaryJob = proofJob(IMPLEMENTATION_JOB_ID, 'Front brake service')
  return {
    id: IMPLEMENTATION_TICKET_ID,
    ticketNumber: 1042,
    source: 'counter',
    status: 'open',
    concern: 'Brake pedal pulses at highway speeds.',
    whenStarted: 'This week',
    howOften: 'Every stop above 50 mph',
    diagnosticAuthorizedCents: null,
    diagnosticAuthorizationNote: null,
    customer: {
      id: '00000000-0000-4000-8000-000000004001',
      name: 'Ada Driver',
      phone: '(214) 555-0142',
      email: 'ada@example.test',
    },
    vehicle: {
      id: '00000000-0000-4000-8000-000000004002',
      year: 2020,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      vin: '1FTFW1E41LFA00042',
      mileage: 91240,
      plate: 'PROOF42',
    },
    jobs: [
      partsMode ? {
        ...primaryJob,
        workStatus: 'blocked',
        approvalState: 'approved',
      } : primaryJob,
      ...(state === 'tie'
        ? [proofJob(IMPLEMENTATION_SECOND_JOB_ID, 'Brake fluid service')]
        : state === 'mixed'
          ? [proofJob(IMPLEMENTATION_SECOND_JOB_ID, 'Brake fluid service', otherTechnician)]
          : []),
    ],
    activities: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function proofPartsArrival(role: ProofRole, state: string | null): PartsArrivalJobView[] {
  if (!state?.startsWith('parts-')) return []
  const readOnly = role === 'tech'
  const ordered = { actorName: 'Pat Parts', at: '2026-08-09T19:20:00.000Z' }
  const received = { actorName: 'Alex Advisor', at: '2026-08-09T19:42:00.000Z' }
  const allHere = state === 'parts-all'
  const lines: PartsArrivalJobView['lines'] = [
    {
      id: '00000000-0000-4000-8000-000000003101',
      description: 'Front brake pad set',
      quantity: '1',
      partNumber: 'BRF-2147',
      brand: 'Brembo',
      state: 'received',
      nextAction: null,
      ordered,
      received,
    },
    {
      id: '00000000-0000-4000-8000-000000003102',
      description: 'Front brake rotor',
      quantity: '2',
      partNumber: 'BRR-8821',
      brand: 'Brembo',
      state: allHere ? 'received' : 'ordered',
      nextAction: allHere || readOnly ? null : 'mark_received',
      ordered,
      received: allHere ? received : null,
    },
  ]
  return [{
    jobId: IMPLEMENTATION_JOB_ID,
    approvedQuoteVersionId: '00000000-0000-4000-8000-000000003100',
    title: 'Front brake service',
    readOnly,
    receivedCount: allHere ? 2 : 1,
    totalCount: 2,
    allHere,
    lines,
  }]
}

function selectedRole(value: string | null): ProofRole {
  return value === 'tech' || value === 'parts' || value === 'owner' ? value : 'advisor'
}

export function ImplementationHarness(): React.JSX.Element {
  const query = new URLSearchParams(window.location.search)
  const role = selectedRole(query.get('role'))
  const state = query.get('state')
  const profileId = profileIds[role]

  useEffect(() => {
    document.body.dataset.routeChanges = '0'
    document.body.dataset.proofKind = 'hermetic-real-components'
  }, [])

  return (
    <div data-real-component-proof data-proof-role={role}>
      <TicketDetailScreen
        ticket={proofTicket(state)}
        canBuildQuote
        canCreateVendorAccount={false}
        currentProfileId={profileId}
        currentProfileName={role === 'tech' ? 'Toni Technician' : `${role} proof`}
        role={role}
        skillTier={role === 'tech' ? 3 : null}
        partsArrival={proofPartsArrival(role, state)}
      />
    </div>
  )
}
