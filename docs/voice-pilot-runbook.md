# Voice Call Feature - Pilot Runbook & Rollout Checklist

**Feature**: AI Voice Call Initiation with User-Controlled Escalation  
**Status**: Provider path implemented, pilot validation pending  
**Version**: 1.0  
**Last Updated**: 2026-03-29

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Go/No-Go Criteria](#gono-go-criteria)
3. [Pre-Pilot Validation](#pre-pilot-validation)
4. [Pilot Runbook](#pilot-runbook)
5. [Rollback Playbook](#rollback-playbook)
6. [Operations Review Checklist](#operations-review-checklist)
7. [Monitoring & Alerting](#monitoring--alerting)
8. [Appendix](#appendix)

---

## Executive Summary

This document guides the pilot launch of AI Voice Call capabilities in the platform. The feature allows:

- **AI agents** to initiate voice calls to customer phone numbers
- **Users** to manually manage call escalation (phone number entry, working hours bypass)
- **Call lifecycle tracking** from initiation through completion
- **Recording storage & retrieval** of all call sessions from `6esk`-owned R2 for audit/compliance
- **Mandatory transcript generation** through an asynchronous STT pipeline writing back into `6esk`

### Key Benefits
- Extends agent capabilities beyond text-based interactions
- Reduces operational latency for urgent customer issues
- Provides audit trail and recordings for compliance
- Maintains user control over escalation decisions

---

## Go/No-Go Criteria

### Pre-Pilot Requirements (Must Pass ✅)

#### 1. selection_required Behavior Verified ✅
**Requirement**: Calls requiring `selection_required: true` in policy must show explicit user confirmation.

**Validation**:
```sql
-- Check policy enforcement
SELECT call_sessions.id, call_sessions.status, 
       call_policies.id as policy_id, call_policies.selection_required
FROM call_sessions
JOIN call_policies ON call_sessions.policy_id = call_policies.id
WHERE call_policies.selection_required = true
LIMIT 10;
```

**Expected Result**: 
- At least 5 test calls showing `selection_required: true` have user confirmation recorded
- Web UI shows explicit confirmation prompt before dialing
- No calls initiated without explicit user action when policy requires it

**Status**: ✅ VERIFIED
- Test cases in `tests/agent-voice-actions.test.ts` validate selection enforcement
- TicketsClient.tsx renders confirmation modal for policy-gated calls

---

#### 2. Recording Attachment Consistency ✅
**Requirement**: Every completed call must have recording metadata correctly attached.

**Validation**:
```sql
-- Check recording metadata completeness
SELECT 
  cs.id,
  cs.status,
  cs.recording_url IS NOT NULL as has_recording_url,
  cs.recording_r2_key IS NOT NULL as has_r2_key,
  cs.duration_seconds,
  COUNT(ce.id) as event_count
FROM call_sessions cs
LEFT JOIN call_events ce ON cs.id = ce.call_session_id
WHERE cs.status = 'completed' AND cs.updated_at > NOW() - INTERVAL '7 days'
GROUP BY cs.id
HAVING COUNT(ce.id) > 0;
```

**Expected Result**: 
- Verified in last 7 days: 100% of completed calls have a playable `6esk` recording URL and `recording_r2_key`
- Missing recording URLs indicate failed storage (alert condition)
- Duration_seconds matches actual audio file length

**Status**: ✅ VERIFIED
- API endpoint `/api/messages/[messageId]/route.ts` fetches recording_url and duration_seconds
- Recording section in TicketsClient.tsx displays audio player with duration
- R2 storage integration tested in calls-outbox-failure.test.ts

---

#### 3. Idempotency Key Validation ✅
**Requirement**: Duplicate requests with same idempotency key must result in single call initiation.

**Validation**:
```sql
-- Check idempotency enforcement
SELECT 
  idempotency_key,
  COUNT(DISTINCT id) as session_count
FROM call_sessions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY idempotency_key
HAVING COUNT(DISTINCT id) > 1;
```

**Expected Result**: 
- Query returns 0 rows (no duplicate sessions with same idempotency key)
- Retries with same key return same call_session_id (not new session)
- Verification logs show `idempotency_lock_acquired` for each unique key

**Status**: ✅ VERIFIED
- Test case: `Manual phone entry with toPhone parameter and idempotency key support`
- Database migration 0022 includes idempotent call event processing
- Agent outbox pattern enforces idempotency via call_sessions.idempotency_key UNIQUE constraint

---

#### 4. Webhook Signature Reliability ✅
**Requirement**: All voice call webhooks must validate HMAC-SHA256 signatures correctly.

**Validation**:
```sql
-- Check webhook signature validation logs
SELECT 
  action,
  COUNT(*) as count,
  ROUND(100 * SUM(CASE WHEN data->>'signature_valid' = 'true' THEN 1 ELSE 0 END) / COUNT(*), 2) as validation_rate
FROM audit_logs
WHERE action LIKE '%webhook%' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY action;
```

**Expected Result**: 
- All webhook records show `signature_valid: true`
- No failed signature validations in last 7 days
- Rejected webhooks logged with error reason in audit trail

**Status**: ✅ VERIFIED
- Test case: `Webhook signature validation under load` in voice-load-failure-injection.test.ts
- Signature verification logic in `/api/calls/webhook` validates HMAC-SHA256
- Rejected webhooks quarantine with reason for later analysis

---

### Pilot Launch Decision

**All Go/No-Go criteria: PENDING REVALIDATION**

**Pilot Launch Approved**: NOT YET  
**Risk Level**: MODERATE until live provider rehearsal is completed  
**Recommended Pilot Size**: 5-10% of operable agent instances after validation

---

## Pre-Pilot Validation

### 1. Database Schema Verification

Run against production database (with backup):

```bash
# Verify voice call tables exist
psql $DATABASE_URL -c "\dt call_sessions call_events call_outbox_events call_policies"

# Expected output: 4 tables, all present
# If any table missing, STOP - do not proceed with pilot
```

**Checklist**:
- [ ] `call_sessions` table exists with all required columns
- [ ] `call_events` table exists for status timeline
- [ ] `call_outbox_events` table exists for async delivery
- [ ] `call_policies` table exists for policy enforcement
- [ ] All related indexes created (migration 0022 includes these)

### 2. Environment Configuration Verification

```bash
# Check required environment variables
env | grep -E 'CALLS_PROVIDER|CALLS_TWILIO_ACCOUNT_SID|CALLS_TWILIO_FROM_NUMBER|CALLS_TWILIO_BRIDGE_TARGET|CALLS_WEBHOOK_SECRET'

# Expected: 6esk Twilio envs should be set for production
# If any missing: contact DevOps to configure before pilot
```

**Checklist**:
- [ ] `CALLS_PROVIDER=twilio`
- [ ] `CALLS_TWILIO_ACCOUNT_SID`
- [ ] `CALLS_TWILIO_AUTH_TOKEN`
- [ ] `CALLS_TWILIO_FROM_NUMBER`
- [ ] `CALLS_TWILIO_BRIDGE_TARGET`
- [ ] `CALLS_WEBHOOK_SECRET` rotated and documented
- [ ] `CALLS_STT_PROVIDER=managed_http`
- [ ] `CALLS_STT_PROVIDER_HTTP_URL` points at `6esk /api/internal/calls/stt/deepgram`
- [ ] `CALLS_STT_PROVIDER_HTTP_SECRET` configured for the internal `6esk` STT backend
- [ ] `CALLS_STT_DEEPGRAM_API_KEY` configured
- [ ] `CALLS_STT_DEEPGRAM_CALLBACK_TOKEN` configured to the Deepgram callback token / key identifier expected by `/api/calls/transcript`
- [ ] `R2_ENDPOINT` configured for the `6esk` Cloudflare R2 account
- [ ] `R2_ACCESS_KEY_ID` configured for `6esk`
- [ ] `R2_SECRET_ACCESS_KEY` configured for `6esk`
- [ ] `R2_BUCKET` points at the `6esk` voice artifact bucket

### 3. API Endpoint Readiness

```bash
# Test voice endpoints
curl -X GET https://api.platform.com/health \
  -H "Authorization: Bearer $TEST_TOKEN"

# Expected: 200 OK with service status

curl -X POST https://api.platform.com/api/agent/v1/actions \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -d '{"action": "initiate_call", "phone": "+15551234567"}'

# Expected: 200 or 400 (with validation error), NOT 500
```

**Checklist**:
- [ ] `/api/calls/inbound` endpoint responds to requests
- [ ] `/api/calls/outbound` endpoint accepts call initiation
- [ ] `/api/calls/status/{id}` returns call details
- [ ] `/api/calls/recording/{id}` returns recording metadata
- [ ] `/api/agent/v1/actions` supports `initiate_call` action
- [ ] No 500 errors in endpoint responses (check logs)

### 4. Monitoring & Observability Readiness

**Dashboard Access**:
- [ ] Grafana dashboard "Voice Call KPIs" accessible
- [ ] Dashboard shows: Total Calls, Success Rate %, Avg Duration, Issues breakdown
- [ ] Alert rules created: Failed Call Rate > 5%, Webhook Validation Failures, Retry Exhaustion

**Log Aggregation**:
- [ ] CloudWatch / ELK logs configured for `call_sessions` inserts
- [ ] Audit logs visible in central system for `call` actions
- [ ] Errors from voice provider visible in logs (searchable by call_session_id)

**Checklist**:
- [ ] Dashboards created and team has access
- [ ] Alert recipients configured (Slack, PagerDuty, email)
- [ ] Log retention set to minimum 90 days
- [ ] Trace ID correlation configured (for end-to-end debugging)

---

## Pilot Runbook

### Phase 1: Soft Launch (Days 1-3)

**Objective**: Enable feature for small group of power users, validate core workflows

**Steps**:

1. **Enable Feature Flag** (t=0)
   ```bash
   # Set feature flag to controlled rollout
   UPDATE feature_flags 
   SET enabled = true, rollout_percentage = 1
   WHERE feature_name = 'voice_calls_enabled';
   
   # Verify setting
   SELECT * FROM feature_flags WHERE feature_name = 'voice_calls_enabled';
   ```
   **Acceptance**: Flag updated, 1% of users have access

2. **Notify Beta Testers** (t=15 min)
   - Internal Slack announcement with test cases
   - Provide 5-10 test agent/ticket IDs
   - Direct beta testers to test scenarios below

3. **Beta Test Scenarios** (t=30 min to 2 hours)
   
   **Scenario A**: Manual phone entry by human user
   ```
   1. Open ticket in staging environment
   2. Click "Initiate Voice Call" button
   3. Enter valid phone number (e.g., +1 555 TEST NUMBER)
   4. Confirm call initiation
   5. Observe call status transition: queued → dialing → in_progress
   6. Check WebRTC endpoint returns ringing signal
   7. Verify recording metadata in call_sessions table
   ```
   **Expected**: Call initiates without errors, recording attachment confirmed
   
   **Scenario B**: Policy-gated call (requires selection_required)
   ```
   1. Open ticket with policy that requires explicit selection
   2. Click "Initiate Voice Call"
   3. Observe explicit confirmation modal appears
   4. Confirm selection in modal
   5. Verify audit log shows user selection timestamp
   ```
   **Expected**: Modal shown, user selection recorded, call proceeds
   
   **Scenario C**: Failed call recovery
   ```
   1. Simulate network timeout (disconnect from internet briefly)
   2. Attempt call initiation during timeout
   3. Observe error message in UI
   4. Reconnect to internet
   5. Click "Retry" button
   6. Verify call initiates with same idempotency key
   ```
   **Expected**: Timeout handled gracefully, retry succeeds with dedupe
   
   **Scenario D**: Recording availability
   ```
   1. Complete a call successfully
   2. Wait 30 seconds for async recording processing
   3. Refresh ticket view
   4. Verify recording section shows audio player
   5. Click play button
   6. Verify audio plays (silent recording acceptable)
   ```
   **Expected**: Recording appears within 30s, audio player works

4. **Monitor Healthcare Metrics** (continuous, Days 1-3)
   
   Every 4 hours, check dashboard:
   ```
   - Total Calls (should be 5-20 in 1% rollout)
   - Success Rate (target: > 95%)
   - Failed Call Count (target: < 1)
   - Avg Duration > 10 seconds (indicates actual connection)
   - Webhook delivery latency (target: < 5s)
   ```
   
   **Alert Triggers** (immediate escalation):
   - Failed Call Rate > 20%
   - Webhook validation failure rate > 0%
   - Any 500 errors in call endpoints
   - Retry exhaustion for any session

5. **Collect Feedback** (daily)
   - Ask beta testers: "Did the feature work as expected?"
   - Document any surprises or issues
   - Check logs for recurring error patterns
   - Update runbook with discovered issues

**End of Phase 1 Decision**:
- ✅ All test scenarios passed
- ✅ No unexpected errors in logs
- ✅ Metrics show > 95% success rate
- **→ Proceed to Phase 2**
- ❌ Issues detected
- **→ Hold pilot, debug using rollback section, re-test after fixes**

---

### Phase 2: Controlled Expansion (Days 4-7)

**Objective**: Expand to 5-10% of all agents, validate load and reliability

**Steps**:

1. **Increase Rollout** (t=0)
   ```bash
   UPDATE feature_flags 
   SET rollout_percentage = 5
   WHERE feature_name = 'voice_calls_enabled';
   ```

2. **Monitor for 24 Hours** (t=0 to t=24h)
   - Dashboard refresh every 2 hours
   - Check metrics baseline established:
     - Calls/hour: ~20-50 (scale with 5% traffic)
     - Success rate: > 95%
     - DB query latency: < 200ms (p95)
     - Webhook delivery: < 5s (p95)

3. **Load Testing** (t=24h, scheduled for off-peak hour)
   ```bash
   # Run pre-recorded load test (concurrent calls)
   npm run test tests/voice-load-failure-injection.test.ts
   
   # Verify all 18 test cases pass:
   # - 100 concurrent calls processed
   # - Batch processing limits respected
   # - No deadlocks or race conditions
   # - All retries exhausted properly
   ```
   
   **Success Criteria**:
   - All tests pass (exit code 0)
   - p95 latency remains < 500ms under load
   - No connection pool exhaustion
   - Audit logs show all operations recorded

4. **Failure Injection Test** (t=48h)
   ```bash
   # Trigger provider timeout scenario
   # (Coordinated with provider support team)
   echo "Simulating 1-minute provider outage"
   
   # Verify:
   # - Pending calls retry with backoff
   # - UI shows retry status to users
   # - Audit logs record failure + retry attempts
   # - Alert fired for provider unavailability
   ```

5. **Team Validation** (t=72h)
   - [ ] Support team reports: No unexpected customer complaints
   - [ ] Operations team reports: Metrics stable, no anomalies
   - [ ] Operations team completes the Admin `Transcript QA` retry drill successfully
   - [ ] Product team reports: Feature adoption as expected
   - [ ] Security team reports: No signature validation failures

**End of Phase 2 Decision**:
- ✅ All metrics healthy, load testing passed
- **→ Proceed to Phase 3 (General Availability)**
- ❌ Issues detected (e.g., > 5% failure rate)
- **→ Pause expansion, investigate, apply fixes, re-test Phase 2**

---

### Phase 3: General Availability (Day 8+)

**Objective**: Enable for all users, validate production stability

**Steps**:

1. **Enable for All Users** (t=0)
   ```bash
   UPDATE feature_flags 
   SET rollout_percentage = 100
   WHERE feature_name = 'voice_calls_enabled';
   ```

2. **Continuous Monitoring** (Daily)
   - 6am, 12pm, 6pm UTC: Check dashboard
   - Review daily report: Calls initiated, success rate, issues
   - Analyze failed calls by root cause:
     - Provider errors (transient vs permanent)
     - User errors (invalid phone, working hours block)
     - System errors (DB, network, signature validation)

3. **Weekly Review** (Every Monday)
   - Total calls processed
   - Aggregate success rate (target > 95%)
   - Top 5 failure reasons
   - Any security/signature validation issues
   - Resource utilization (CPU, DB connections, R2 API quota)

4. **SLA Tracking**
   - Call initiation latency (p95 < 500ms)
   - Recording availability (attachment within 30s)
   - Webhook delivery (p95 < 5s)
   - Audit trail completeness (100% of calls logged)

---

## Rollback Playbook

### Quick Rollback (< 5 minutes)

**Use when**: Uncontrolled failure rate detected (> 20% failures)

**Steps**:

1. **Disable Feature Immediately**
   ```bash
   UPDATE feature_flags 
   SET enabled = false
   WHERE feature_name = 'voice_calls_enabled';
   ```

2. **Verify Disabled**
   ```bash
   SELECT * FROM feature_flags WHERE feature_name = 'voice_calls_enabled';
   # Should show: enabled = false
   ```

3. **Notify Stakeholders**
   - Send to #incident Slack channel
   - Message: "Voice calls feature rolled back due to [REASON]"
   - Expected restart time: TBD
   - Customer impact: Users will not see "Initiate Call" button

4. **Stop All In-Flight Calls**
   ```bash
   -- Mark pending calls as rolledback (don't deliver)
   UPDATE call_outbox_events 
   SET status = 'cancelled'
   WHERE status IN ('queued', 'pending')
   AND created_at > NOW() - INTERVAL '5 minutes';
   
   -- Record maintenance event
   INSERT INTO audit_logs (action, data, created_by)
   VALUES ('feature_rollback', 
           '{"reason": "failure_rate_exceeded", "rollback_time": NOW()}',
           'system');
   ```

5. **Post-Incident Investigation**
   - [ ] Export logs from last 30 minutes
   - [ ] Identify root cause
   - [ ] Check provider status page
   - [ ] Verify no DB connectivity issues
   - [ ] Review audit trail for anomalies

---

### Selective Rollback (10-15 minutes)

**Use when**: Issue affects specific user segment (e.g., one provider region)

**Steps**:

1. **Identify Affected Scope**
   ```sql
   -- Find calls failing in specific region
   SELECT 
     cs.id, cs.from_phone, cs.to_phone, cs.status,
     coe.attempt_count, coe.error_message
   FROM call_sessions cs
   JOIN call_outbox_events coe ON cs.id = coe.call_session_id
   WHERE cs.created_at > NOW() - INTERVAL '1 hour'
   AND coe.status = 'failed'
   AND cs.to_phone LIKE '%[COUNTRY_CODE]%';
   ```

2. **Disable for Affected Region Only**
   ```bash
   UPDATE feature_flag_exceptions 
   SET enabled = false
   WHERE feature_name = 'voice_calls_enabled'
   AND country_code = '[AFFECTED_COUNTRY]';
   ```

3. **Monitor Affected Users**
   - Verify: No more calls initiated in affected region
   - Check: Unaffected regions continue functioning normally

---

## Operations Review Checklist

### Daily Review (5 minutes)

**Time**: 6am UTC (beginning of business day)

**Checklist**:

- [ ] Check Grafana dashboard: All 4 KPI cards visible and displaying data
  - [ ] Total Calls card showing inbound/outbound split
  - [ ] Success Rate card showing percentage and completion count
  - [ ] Avg Duration card showing duration in seconds
  - [ ] Issues card showing failed/no-answer/busy breakdown
- [ ] Check alert history: Any triggered in last 24 hours?
  - [ ] If yes: Acknowledge alert, investigate logs
  - [ ] If failed webhook: Check provider status page
  - [ ] If retry exhaustion: Review specific call_session_id
- [ ] If transcript QA failed jobs are present: run the Admin `Transcript QA` retry drill and confirm the failed count drops or the job leaves the failed list
- [ ] Spot-check latest call_sessions in database:
  ```sql
  SELECT id, status, duration_seconds, recording_url 
  FROM call_sessions 
  ORDER BY created_at DESC LIMIT 5;
  ```
  - [ ] All have `status = 'completed'` or reasonable in-progress state
  - [ ] All completed calls have `recording_url` populated
  - [ ] Duration > 0 (indicates actual connection)

**Escalation Criteria**:
- ❌ Dashboard unreachable → Contact DevOps
- ❌ Multiple failed calls in sequence → Check logs, consider rollback
- ❌ Recording URL NULL for completed call → Database integrity issue

---

### Weekly Review (30 minutes)

**Time**: Monday 9am UTC (start of week)

**Report Contents**:

1. **Volume Metrics**
   ```sql
   SELECT 
     DATE(created_at) as date,
     COUNT(*) as total_calls,
     COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
     COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
     ROUND(100 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*), 2) as success_rate
   FROM call_sessions
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at)
   ORDER BY date DESC;
   ```

2. **Failure Analysis**
   ```sql
   SELECT 
     status,
     error_reason,
     COUNT(*) as count
   FROM call_sessions
   WHERE created_at > NOW() - INTERVAL '7 days'
   AND status IN ('failed', 'no_answer', 'busy')
   GROUP BY status, error_reason
   ORDER BY count DESC;
   ```

3. **Performance Metrics**
   - [ ] Avg Call Duration: `SELECT AVG(duration_seconds) FROM call_sessions WHERE created_at > NOW() - INTERVAL '7 days'`
   - [ ] P95 Initiation Latency: Query from CloudWatch metrics
   - [ ] Recording Processing Time: Avg time from completion to recording_url available
   - [ ] Webhook Delivery Latency: P95 delivery time from event fire to confirmed delivery

4. **Audit & Compliance**
   - [ ] All calls have audit trail entries
   - [ ] Recording storage verified (no missing R2 objects)
   - [ ] Signature validation: 100% success rate
   - [ ] Policy enforcement: All selection_required calls + user confirmation

5. **Resource Utilization**
   - [ ] Database: Connection pool utilization < 80%
   - [ ] Storage: R2 usage growth < 10% daily
   - [ ] API quota: Voice provider hasn't hit rate limits

6. **Customer Feedback**
   - [ ] Support tickets mentioning voice calls: [COUNT]
   - [ ] Sentiment: Positive / Neutral / Negative
   - [ ] Any UX improvements requested?

**Escalation Criteria**:
- Success rate drops below 90%
- More than 2 failed calls to same customer on same day
- Recording processing takes > 5 minutes
- Webhook delivery exceeds 10 seconds at p95

---

## Monitoring & Alerting

### Key Metrics to Monitor

| Metric | Target | Alert Threshold | Check Frequency |
|--------|--------|-----------------|-----------------|
| Success Rate (%) | 95% | < 90% | Every 15 min |
| Failed Call Count | 0 per hour | > 5 per hour | Every 15 min |
| Avg Duration (sec) | > 10 | < 5 sec | Every 1 hour |
| Webhook Latency (p95) | < 5s | > 10s | Every 15 min |
| Recording Attachment Time | < 30s | > 60s | Every 1 hour |
| DB Query Latency (p95) | < 200ms | > 500ms | Every 15 min |
| Signature Validation Rate | 100% | < 99% | Every 1 hour |
| Retry Exhaustion Count | 0 per day | > 3 per day | Daily |

### Alert Actions

**High Priority Alerts** (Page on-call only if):
- Failed call rate > 20% for > 10 minutes
- Webhook signature validation failures (any)
- Retry exhaustion for key feature call types

**Medium Priority Alerts** (Slack notification):
- Recording processing > 5 minutes
- Database connection pool > 80%
- P95 latency > 500ms

---

## Appendix

### A. Database Migration Verification

After database migrations applied, verify:

```bash
# Migration 0020: Call foundations
psql $DATABASE_URL -c "
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'call_sessions'
  ) as call_sessions_exists;"

# Migration 0021: Consent events
psql $DATABASE_URL -c "
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'call_consent_events'
  ) as consent_events_exists;"

# Migration 0022: Event sequence & status
psql $DATABASE_URL -c "
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'call_events'
  ) as call_events_exists;"
```

### B. Test Data Generation

For load testing, generate test calls:

```sql
-- Insert test call sessions (non-production only)
INSERT INTO call_sessions 
  (id, to_phone, from_phone, policy_id, status, duration_seconds, 
   recording_url, recording_r2_key, created_by)
VALUES
  (gen_random_uuid(), '+15551234567', '+1800-PLATFORM', NULL, 
   'completed', 42, 'https://r2.example.com/call-1.wav', 'call-1.wav', 'test');
```

### C. Provider Integration Checklist

Before enabling for provider, verify:

**Twilio** (if using):
- [ ] API account active and verified
- [ ] Phone numbers purchased for origination
- [ ] `6esk` callback URLs reachable from Twilio:
  - [ ] `/api/calls/webhooks/twilio/status`
  - [ ] `/api/calls/webhooks/twilio/recording`
- [ ] `6esk` can fetch provider recording media directly with Twilio auth
- [ ] Bridge target format matches deployment (`+E164` PSTN or `client:<identity>`)

**Other Providers**:
- [ ] Authentication tokens configured
- [ ] Endpoint URLs verified with provider docs
- [ ] Webhook signature algorithm documented
- [ ] Rate limits reviewed and capacity planned

### D. Emergency Contacts

| Role | Name | Phone | Slack |
|------|------|-------|-------|
| On-Call DevOps | [Name] | [Phone] | @oncall-devops |
| Voice Provider Support | N/A | [Provider Support #] | N/A |
| Database Admin | [Name] | [Phone] | @db-admin |

### E. Known Limitations & Future Work

**Current Pilot Limitations**:
1. Transcript generation is mandatory but still depends on live provider/STT rollout validation
2. Call transfer not supported (single-leg calls only)
3. Working hours policy applies to all calls (no overrides)
4. No warm handoff between AI and human agent

**Future Enhancements**:
- Transcript summarization and QA on top of the mandatory raw transcript pipeline
- Multi-leg calls (transfer to human agent)
- Call recording with speaker identification
- Real-time call sentiment analysis

---

**Document Owner**: Platform Team  
**Last Reviewed**: 2026-02-20  
**Next Review**: 2026-03-20
