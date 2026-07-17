export const CONTINUITY_WRITER_INVENTORY_V1 = [
  {
    file: 'lib/tickets.ts',
    mutations: ['createTicket', 'addTicketJob', 'mutateTicketJobAssignment'],
  },
  { file: 'lib/intake/counter-ticket.ts', mutations: ['createCounterTicket'] },
  { file: 'lib/intake/quick-ticket.ts', mutations: ['createQuickTicket'] },
  {
    file: 'lib/shop-os/canned-jobs.ts',
    mutations: ['applyCannedJobToTicket'],
  },
  {
    file: 'lib/shop-os/customer-stories.ts',
    mutations: ['generateAndSaveCustomerStory', 'saveReviewedCustomerStory'],
  },
  {
    file: 'lib/shop-os/diagnostic-start.ts',
    mutations: [
      'acquireDiagnosticStart',
      'finalizeDiagnosticStart',
      'recordDiagnosticStartFailure',
    ],
  },
  {
    file: 'lib/shop-os/parts-offers.ts',
    mutations: ['captureManualOffer', 'removeManualOffer'],
  },
  {
    file: 'lib/shop-os/quotes.ts',
    mutations: [
      'createQuoteVersion',
      'recordQuoteDecision',
      'createDraftLine',
      'replaceDraftLine',
      'deleteDraftLine',
    ],
  },
  {
    file: 'lib/shop-os/simple-work.ts',
    mutations: ['mutateSimpleWork', 'createWorkEscalation'],
  },
  {
    file: 'lib/sessions.ts',
    mutations: ['createSessionForUser', 'closeSessionForUser'],
    allowedEntrypointsByMutation: {
      createSessionForUser: ['app/api/sessions/route.ts#POST'],
      closeSessionForUser: ['app/api/sessions/[id]/close/route.ts#POST'],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const

export const CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1 = [
  {
    file: 'lib/intake/ticket-identity.ts',
    mutations: ['materializeTicketIntakeIdentityInLockedScopeV1'],
    callers: ['createCounterTicket', 'createQuickTicket'],
    returnsOpaque: 'MaterializedTicketIntakeIdentityV1',
    soleConsumer: 'lib/tickets.ts#resolveTicketCreationInLockedScopeV1',
    createdRowsBridge:
      'lib/tickets.ts#finalizeResolvedTicketCreationInTransactionV1',
  },
] as const

export const CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1 = [
  {
    file: 'lib/db/queries.ts',
    helper: 'appendSessionEvent',
    allowedCallers: [
      'lib/sessions.ts#advanceSession',
      'lib/sessions.ts#closeSessionForUser',
      'lib/sessions.ts#recordAmbientConditions',
      'lib/sessions.ts#releaseGateForUser',
      'lib/sessions.ts#declineOrDeferSessionForUser',
      'lib/sessions.ts#abandonSessionForUser',
      'lib/sessions.ts#lockDiagnosisForUser',
      'lib/sessions.ts#lockDiagnosisFromWizard',
      'lib/sessions.ts#submitRepairObservationForUser',
    ],
    ticketLinkedCallers: [
      'lib/sessions.ts#closeSessionForUser',
      'lib/sessions.ts#submitRepairObservationForUser',
    ],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'closeSession',
    allowedCallers: ['lib/sessions.ts#closeSessionForUser'],
    ticketLinkedCallers: ['lib/sessions.ts#closeSessionForUser'],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionTreeState',
    allowedCallers: [
      'lib/sessions.ts#advanceSession',
      'lib/sessions.ts#recordAmbientConditions',
      'lib/sessions.ts#releaseGateForUser',
      'lib/sessions.ts#lockDiagnosisForUser',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionIntake',
    allowedCallers: ['lib/sessions.ts#recordAmbientConditions'],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionMaxCorpusSimilarity',
    allowedCallers: [
      'lib/retrieval/wire-into-tree.ts#buildUpdateTreeWithRetrieval',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'setSessionTerminalStatus',
    allowedCallers: [
      'lib/sessions.ts#declineOrDeferSessionForUser',
      'lib/sessions.ts#abandonSessionForUser',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'createSession',
    allowedCallers: [],
    ticketLinkedCallers: [],
    gate: 'currently_unreferenced_fail_on_new_caller',
    ownsLocksOrFinalization: false,
  },
] as const

export const CONTINUITY_LOCK_ONLY_INVENTORY_V1 = [
  {
    file: 'lib/shop-os/repair-authorization.ts',
    transactions: ['lockDiagnosticRepairAccess'],
  },
  {
    file: 'lib/sessions.ts',
    transactions: [
      'replayCompletedTechQuickSessionForUser',
      'submitRepairObservationForUser',
    ],
    allowedEntrypointsByTransaction: {
      replayCompletedTechQuickSessionForUser: ['app/api/sessions/route.ts#POST'],
      submitRepairObservationForUser: [
        'app/api/sessions/[id]/repair-observation/route.ts#POST',
      ],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
  {
    file: 'lib/diagnostics/adaptive/state.ts',
    transactions: ['updateAdaptiveModeForUser'],
    lockedAuthorizer:
      'lib/diagnostics/adaptive/actor.ts#authorizeAdaptiveMutationInLockedScopeV1',
    allowedEntrypoints: [
      'app/api/sessions/[id]/adaptive/mode/route.ts#POST',
    ],
    gate: 'diagnostics_release_and_entitlement_refused',
    ownsFinalization: false,
  },
] as const

export const CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1 = [
  {
    file: 'lib/intake/session.ts',
    mutations: ['createSessionFromIntake'],
    allowedEntrypoints: ['app/api/intake/submit/route.ts#POST'],
    nestedHelpers: [
      'lib/intake/customers.ts#upsertCustomer',
      'lib/intake/vehicles.ts#upsertVehicle',
    ],
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const

export const CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1 = [
  {
    file: 'lib/sessions.ts',
    mutations: [
      'advanceSession',
      'captureArtifact',
      'recordAmbientConditions',
      'releaseGateForUser',
      'declineOrDeferSessionForUser',
      'abandonSessionForUser',
      'lockDiagnosisForUser',
      'lockDiagnosisFromWizard',
    ],
    allowedEntrypointsByMutation: {
      advanceSession: [
        'app/api/sessions/[id]/advance/route.ts#POST',
        'app/api/sessions/[id]/advance/stream/route.ts#POST',
      ],
      captureArtifact: [],
      recordAmbientConditions: [
        'app/api/sessions/[id]/ambient/route.ts#POST',
      ],
      releaseGateForUser: [
        'app/api/sessions/[id]/release-gate/route.ts#POST',
      ],
      declineOrDeferSessionForUser: [
        'app/api/sessions/[id]/decline-or-defer/route.ts#POST',
      ],
      abandonSessionForUser: [
        'app/api/sessions/[id]/abandon/route.ts#POST',
      ],
      lockDiagnosisForUser: [
        'app/api/sessions/[id]/lock-diagnosis/route.ts#POST',
      ],
      lockDiagnosisFromWizard: [
        'app/api/sessions/[id]/lock-in-diagnosis/route.ts#POST',
      ],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
  {
    file: 'lib/retrieval/wire-into-tree.ts',
    mutations: ['buildUpdateTreeWithRetrieval'],
    nestedWriter: 'lib/db/queries.ts#updateSessionMaxCorpusSimilarity',
    allowedCallers: [
      'app/api/sessions/[id]/advance/route.ts#POST',
      'app/api/sessions/[id]/advance/stream/route.ts#POST',
      'app/api/sessions/[id]/ambient/route.ts#POST',
    ],
    gate:
      'diagnostics_release_gated_session_only_ticket_link_allowed_no_ticket_graph_access',
  },
  {
    file: 'lib/curator/deferred-actions.ts',
    mutations: [
      'approveDeferredSession',
      'overrideDeferredSession',
      'closeDeferredSession',
    ],
    allowedCallers: [
      'app/api/curator/sessions/[id]/approve/route.ts#POST',
      'app/api/curator/sessions/[id]/override/route.ts#POST',
      'app/api/curator/sessions/[id]/close/route.ts#POST',
    ],
    gate: 'curator_global_non_ticket_session_only_enforced',
  },
  {
    file: 'app/api/sessions/[id]/wizard-state/route.ts',
    mutations: ['POST'],
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const
