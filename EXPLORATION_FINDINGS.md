# 6esk Codebase Exploration: VOICE-074/075, Merges & Agent Actions

**Date**: March 18, 2026  
**Workspace**: 6esk (Next.js + Postgres CRM platform)

---

## Executive Summary

The 6esk codebase has **comprehensive customer merge and agent action infrastructure already implemented**. The main gaps are in **load testing harness** and **automated drill scripts** for operations.

| Feature | Status | Notes |
|---------|--------|-------|
| **1. VOICE-074 Load/Failure Tests** | 🟡 Partial | Test suite exists; lacks harness & performance benchmarks |
| **2. VOICE-075 Runbook** | 🟡 Partial | Documentation exists; lacks drill scripts & automation |
| **3. Customer Deduplication** | ✅ Complete | Full schema, business logic, APIs implemented |
| **4. Merge Review UI** | 🟡 Partial | Backend complete; missing dedicated queue page |
| **5. Agent Merge Actions** | ✅ Complete | All merge types support AI execution with safety gates |

---

## 1. VOICE-074: Load & Failure Injection Tests

### What Exists ✅

**File**: [tests/voice-load-failure-injection.test.ts](tests/voice-load-failure-injection.test.ts) (350+ lines)

**Test Coverage**:
- ✅ Outbox delivery with exponential backoff retry (60s → 300s → 900s)
- ✅ Failure categorization (retryable vs non-retryable)
- ✅ Max retry enforcement (prevents infinite loops)
- ✅ Audit logging of failures with full context
- ✅ Concurrency control (prevents duplicate event processing)
- ✅ Atomicity guarantees (all-or-nothing delivery)
- ✅ Observability metrics (latency, success rate, provider throughput)
- ✅ Webhook replay validation with HMAC signature verification

**Test Implementation**:
```typescript
describe("voice call load and failure injection", () => {
  // Mocks for db, calls/service, audit, agents/outbox
  describe("outbox delivery scenarios") { /* delivery patterns */ }
  describe("failure handling and recovery") { /* categorization */ }
  describe("concurrency and atomicity") { /* locking */ }
  describe("observability and metrics") { /* SLA tracking */ }
  describe("webhook replay and verification") { /* HMAC validation */ }
});
```

### What's Missing ❌

1. **Load Test Harness**: Tests are unit-level; no actual concurrent load generation
2. **Performance Benchmarks**: No defined SLA thresholds (e.g., "p99 latency < 500ms")
3. **Failure Injection Framework**: No systematic fault injection (network partitions, provider throttling)
4. **Capacity Tests**: No tests for provider rate limits or backpressure
5. **Load Test Documentation**: Missing how-to guide for running at scale

### Recommended Next Steps
- Create `scripts/load-test-harness.ts` for concurrent call delivery simulation
- Define SLA targets per environment (`LOAD_TEST_CONCURRENCY=100`, `TARGET_P99_LATENCY=500`)
- Add fault injection (chaos engineering approach)
- Document load test execution in `docs/load-testing-guide.md`

---

## 2. VOICE-075: Ops Runbook & Drill Scripts

### What Exists ✅

**Primary Files**:
- [docs/voice-pilot-runbook.md](docs/voice-pilot-runbook.md) — Go/no-go criteria, pre-pilot validation, pilot rollout
- [docs/call-ops-runbook.md](docs/call-ops-runbook.md) — Daily health checks, replay validation, retry handling
- [docs/Venus-Voice.md](docs/Venus-Voice.md) — Feature overview (if applicable)

**Runbook Content**:
```
✅ Daily Health Checks
   - GET /api/admin/calls/outbox (queue depth)
   - GET /api/admin/calls/failed (failures in range)
   - GET /api/admin/calls/rejections (webhook rejections)
   - Targets: <2% rejection rate, no backlog growth

✅ Replay-Window Drill
   - Validates webhook HMAC + timestamp replay protection
   - Checks request signing within +/- CALLS_WEBHOOK_MAX_SKEW_SECONDS (300s default)

✅ Rollback Procedure
   - Set CALLS_PROVIDER=mock (disable real calls)
   - Clear call_outbox and call_sessions if needed
   - Verify no active call_webhook_events

✅ Environment Configuration
   - CALLS_PROVIDER, CALLS_WEBHOOK_SECRET, CALLS_OUTBOX_SECRET
   - CALLS_WEBHOOK_MAX_SKEW_SECONDS (default 300)
   - CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE (must be false post-migration)
```

### What's Missing ❌

1. **Load Test Drill Script** (`scripts/load-test-drill.ps1`)
   - Concurrent call delivery under load
   - Success/failure rate reporting
   
2. **Replay Drill Automation** (`scripts/replay-window-drill.ps1`)
   - Currently manual PowerShell; needs automated execution
   
3. **Retry Drill** (`scripts/retry-drill.ps1`)
   - Simulate failed events, verify retry logic
   
4. **Incident Response Guide**
   - "What to do if rejection rate spikes"
   - "How to recover from partial outbox failure"
   
5. **Rollback Validation Checklist**
   - Specific checks to verify successful rollback

### Recommended Next Steps
- Create drill scripts in `scripts/` directory:
  ```powershell
  scripts/call-ops-replay-window-drill.ps1
  scripts/call-ops-load-drill.ps1
  scripts/call-ops-retry-drill.ps1
  scripts/call-ops-health-check.ps1
  ```
- Document expected outputs for each drill
- Add incident response flowchart to `docs/`

---

## 3. Customer Identity Deduplication

### What Exists ✅

#### Database Schema
**Migrations**:
- [db/migrations/0017_customer_merge_foundations.sql](db/migrations/0017_customer_merge_foundations.sql)
- [db/migrations/0018_merge_review_tasks.sql](db/migrations/0018_merge_review_tasks.sql)

**Core Tables**:
```sql
customers (
  id, kind [registered|unregistered], external_system, external_user_id,
  display_name, primary_email, primary_phone,
  merged_into_customer_id, merge_reason, merged_by_user_id, merged_at
)

customer_identities (
  id, customer_id, identity_type [email|phone], identity_value,
  is_primary, source
  -- UNIQUE(identity_type, identity_value) per identity
)

customer_merges (
  id, source_customer_id, target_customer_id, reason, actor_user_id
)

tickets (
  ... existing columns ...
  customer_id, merged_into_ticket_id, merged_by_user_id, merged_at
)

merge_review_tasks (
  See section 4 below
)
```

#### Business Logic
**File**: [src/server/merges.ts](src/server/merges.ts)

```typescript
export async mergeCustomers({
  sourceCustomerId, targetCustomerId, reason, mergedByUserId
}): Promise<CustomerMergeResult>

export async mergeTickets({
  sourceTicketId, targetTicketId, reason, mergedByUserId
}): Promise<TicketMergeResult>

export async preflightCustomerMerge({
  sourceCustomerId, targetCustomerId
}): Promise<CustomerMergePreflight>
```

**Constraints**:
- Source and target must be different
- Source and target must not already be merged
- Cross-channel ticket merge blocked (email ≠ whatsapp ≠ voice)
- Ticket merge row movement capped at `TICKET_MERGE_MAX_MOVE_ROWS` (default 5000)

#### API Routes
```
POST /api/customers/merge/preflight (validation only)
POST /api/customers/merge (requires MERGE_IRREVERSIBLE_ACK_TEXT acknowledgement)
POST /api/tickets/merge/preflight (validation only)
POST /api/tickets/merge (requires irreversible ack)
GET /api/tickets/search?q=&limit= (for merge UI)
GET /api/customers/search?q=&limit= (for merge UI)
```

#### Tests
- [tests/customer-merge-api.test.ts](tests/customer-merge-api.test.ts)
- [tests/customer-merge-preflight-api.test.ts](tests/customer-merge-preflight-api.test.ts)
- [tests/ticket-merge-api.test.ts](tests/ticket-merge-api.test.ts)
- [tests/ticket-merge-preflight-api.test.ts](tests/ticket-merge-preflight-api.test.ts)

### What's Missing ❌

Nothing critical. All customer deduplication is production-ready.

**Optional Enhancements**:
- UI for bulk identity resolution (match emails across tickets)
- "Smart merge" recommendations (ML-based duplicate detection)
- Merge conflict warnings (e.g., tickets with same subject)

---

## 4. Merge Review UI & Queue Interface

### What Exists ✅

#### Backend Infrastructure
**Merge Review Service**: [src/server/merge-reviews.ts](src/server/merge-reviews.ts)

```typescript
createMergeReviewTask({
  proposalType, ticketId, sourceTicketId, targetTicketId,
  sourceCustomerId, targetCustomerId, reason, confidence,
  proposedByAgentId, proposedByUserId
}): Promise<MergeReviewTask>

listMergeReviewTasksForUser(user, {
  status [pending|approved|rejected|applied|failed|all],
  search, limit, assignedUserId
}): Promise<MergeReviewQueueItem[]>

resolveMergeReviewTask({
  reviewId, decision [approve|reject], actorUserId, note
}): Promise<MergeReviewOperationResult>
```

**API Routes**:
```
GET /api/merge-reviews?status=pending&q=duplicate&limit=50&assigned=mine
  Returns: MergeReviewQueueItem[] with full context

PATCH /api/merge-reviews/[reviewId]
  Body: { decision: "approve"|"reject" }
  Executes merge if approved, records rejection if rejected
```

**Queue Item Structure** (rich view):
```typescript
{
  id, status, proposal_type,
  source_ticket_id, target_ticket_id,           // For ticket merges
  source_customer_id, target_customer_id,       // For customer merges
  reason, confidence, metadata,
  proposed_by_agent_id, proposed_by_user_id,
  reviewed_by_user_id, reviewed_at,
  -- Context for UI display --
  context_ticket_subject, context_ticket_requester_email,
  source_ticket_subject, source_ticket_requester_email,
  source_ticket_has_whatsapp, source_ticket_has_voice,
  target_ticket_subject, target_ticket_requester_email,
  target_ticket_has_whatsapp, target_ticket_has_voice,
  source_customer_display_name, source_customer_primary_email, source_customer_primary_phone,
  target_customer_display_name, target_customer_primary_email, target_customer_primary_phone
}
```

#### UI Components (Partial)
**File**: [src/app/tickets/TicketsClient.tsx](src/app/tickets/TicketsClient.tsx)

```typescript
// State management
const [mergeReviewQueue, setMergeReviewQueue] = useState<MergeReviewQueueItem[]>([])
const [mergeReviewStatusFilter, setMergeReviewStatusFilter] = useState<"pending"|"all">()

// Functions
async function loadMergeReviewQueue() { /* GET /api/merge-reviews */ }
async function resolveMergeReview(review, decision) { /* PATCH /api/merge-reviews/[id] */ }

// Display
- Merge review status in ticket details
- List of pending reviews accessible from ticket view
```

**Analytics Dashboard**: [src/app/analytics/AnalyticsClient.tsx](src/app/analytics/AnalyticsClient.tsx)

```typescript
- Ticket merges vs customer merges count
- AI-initiated vs human-initiated split
- Pending review count
- Rejected/failed in time range
- Top failure reasons for reviews
```

### What's Missing ❌

1. **Dedicated Merge Review Queue Page**
   - Missing: `src/app/merge-reviews/page.tsx`
   - Should display full queue with filters, search, bulk actions
   
2. **Merge Comparison View**
   - Missing: Side-by-side diff of source vs target before approval
   - Should highlight conflicts (e.g., different customer names)
   
3. **Bulk Review Actions**
   - Missing: Approve/reject multiple reviews at once
   - Missing: Reassign reviews to another user
   
4. **Merge History View**
   - Missing: Audit trail of completed merges (who approved, when, reason)
   - Should be filterable by date, actor, type
   
5. **Conflict Detection**
   - Missing: Warnings for problematic merges
   - E.g., "Both tickets have same subject" or "Source customer has recent activity"

### Recommended Next Steps
- Create merge review management page at `src/app/merge-reviews/`
- Add comparison component showing source ↔ target diffs
- Implement bulk approve/reject UI
- Add conversation history for merge reasoning

---

## 5. Agent Merge Actions (AI-Driven Merges)

### What Exists ✅

#### Full Implementation
**File**: [src/app/api/agent/v1/actions/route.ts](src/app/api/agent/v1/actions/route.ts)

**Supported Merge Actions**:
```typescript
type MergeActionType = 
  | "merge_tickets"        // Direct merge of two tickets
  | "merge_customers"      // Direct merge of two customers
  | "propose_merge"        // Creates review task for human approval
  | "request_human_review" // General escalation (context-dependent)
```

**Safety Validation**:
```typescript
function validateMergeSafety(action) {
  ✅ Requires: action.reason (explicit reasoning)
  ✅ Requires: action.confidence (0-1 score)
  ✅ Enforces: confidence >= AGENT_MERGE_MIN_CONFIDENCE (default 0.85, env configurable)
  ✅ Enforces: agent.capabilities.allow_merge_actions === true for direct merges
  ✅ Fallback: Creates merge review task if confidence too low or capability disabled
}
```

**Merge Action Execution Flow**:

```
Input: merge_tickets / merge_customers action with confidence & reason

├─ Is confidence >= AGENT_MERGE_MIN_CONFIDENCE?
│  ├─ NO  → Create merge_review_task (pending human approval)
│  └─ YES → Check agent.capabilities.allow_merge_actions
│
├─ Is allow_merge_actions=true?
│  ├─ NO  → Create merge_review_task (pending human approval)
│  └─ YES → Execute merge immediately
│
├─ Execute merge
│  ├─ Update source/target tables
│  ├─ Record merge_audit_log
│  ├─ Publish agent events
│  └─ Return result or error
│
└─ Log event: ticket.merged | customer.merged | merge.review.required
```

**Agent Events Published**:
```
ticket.merged {
  ticketId, mergedIntoTicketId, sourceChannel, targetChannel,
  mergedByAgentId, reason, confidence
}

customer.merged {
  customerId, mergedIntoCustomerId,
  mergedByAgentId, reason, confidence
}

customer.identity.resolved {
  customerId, email, phone, source
}

merge.review.required {
  mergeReviewTaskId, proposalType, reason, confidence
}
```

**Configuration**:
- `AGENT_MERGE_MIN_CONFIDENCE` (env var, default 0.85)
- `SIXESK_ALLOW_DIRECT_MERGE_ACTIONS` (feature flag)
- `integration.capabilities.allow_merge_actions` (per-integration setting)

#### Tests
- [tests/agent-merge-actions.test.ts](tests/agent-merge-actions.test.ts)
  - ✅ Blocks direct merge when `allowMergeActions` capability disabled
  - ✅ Enforces confidence minimum threshold
  - ✅ Tests `propose_merge` flow (creates review)
  - ✅ Tests direct merge flow (executes immediately)
  - ✅ Tests `merge_customers` action type
  - ✅ Tests `merge_tickets` action type

### What's Missing ❌

1. **UI for Agent Capabilities Management**
   - Missing: Page to set `allow_merge_actions` per agent integration
   - Currently requires database edit

2. **Agent Merge Action Audit Dashboard**
   - Missing: View of all agent-proposed merges (successful + review-pending)
   - Should show agent name, proposal reason, execution status

3. **Merge Confidence Score Documentation**
   - Missing: Guidance for agents on how to score confidence (0.0 = no confidence, 1.0 = certain)

### Recommended Next Steps
- Add agent capabilities UI at `src/app/admin/agents/[agentId]/capabilities`
- Create agent merge audit view at `src/app/admin/agent-merges`
- Document confidence scoring best practices

---

## File Map: Where Everything Lives

| Feature | Backend Logic | API Routes | Tests | UI/Components |
|---------|---------------|-----------|-------|--------------|
| **Merges** | `src/server/merges.ts` | `src/app/api/customers/merge/*` `src/app/api/tickets/merge/*` | `tests/customer-merge*.test.ts` `tests/ticket-merge*.test.ts` | `src/app/tickets/TicketsClient.tsx` |
| **Merge Reviews** | `src/server/merge-reviews.ts` | `src/app/api/merge-reviews/*` | `tests/merge-reviews*.test.ts` `tests/merge-review-decision*.test.ts` | `src/app/tickets/TicketsClient.tsx` + Analytics |
| **Agent Actions** | (above) | `src/app/api/agent/v1/actions/route.ts` | `tests/agent-merge-actions.test.ts` | None (API-driven) |
| **Database** | — | — | — | — |
| • Customers | — | — | — | — |
| • Merges | — | — | — | — |
| • Reviews | [db/migrations/0018_merge_review_tasks.sql](db/migrations/0018_merge_review_tasks.sql) | — | — | — |
| **Load Tests** | — | — | [tests/voice-load-failure-injection.test.ts](tests/voice-load-failure-injection.test.ts) | — |
| **Runbooks** | — | — | — | — |
| • Pilot | [docs/voice-pilot-runbook.md](docs/voice-pilot-runbook.md) | — | — | — |
| • Ops | [docs/call-ops-runbook.md](docs/call-ops-runbook.md) | — | — | — |

---

## Implementation Checklist

### Quick Wins (< 1 day each)
- [ ] Create `docs/load-testing-guide.md` with performance targets
- [ ] Create `scripts/call-ops-health-check.ps1` for daily checks
- [ ] Add agent capabilities UI at `src/app/admin/agents/`

### Medium Tasks (1-2 days each)
- [ ] Create `scripts/load-test-harness.ts` for concurrent call simulation
- [ ] Create `scripts/call-ops-replay-drill.ps1` automation
- [ ] Create agent merge audit dashboard at `src/app/admin/agent-merges`

### Larger Tasks (2-3 days each)
- [ ] Dedicated merge review management page (`src/app/merge-reviews/`)
- [ ] Merge comparison/diff UI component
- [ ] Bulk merge action UI (approve multiple reviews)
- [ ] Merge conflict detection warnings

---

## Conclusion

**The 6esk merge infrastructure is production-ready.** The platform has:
- ✅ Full customer identity deduplication
- ✅ AI merge action support with safety gates
- ✅ Human review workflow for merge approval
- ✅ Comprehensive backend API

**The main gaps are operational:**
- 🟡 Load test harness (test suite exists, needs orchestration)
- 🟡 Drill scripts (manual runbooks exist, needs automation)
- 🟡 UI polish (core functionality exists, needs dedicated management page)

See [/memories/session/voice-075-merge-exploration-findings.md](/memories/session/voice-075-merge-exploration-findings.md) for detailed findings summary.
