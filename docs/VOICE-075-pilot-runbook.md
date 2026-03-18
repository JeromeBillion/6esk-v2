# VOICE-075: Pilot Runbook + Rollout Checklist + Rollback Playbook

This document covers the complete pilot execution, rollout strategy, and emergency rollback procedures for 6esk voice calling.

## Pre-Launch Validation Checklist (VOICE-075 Part 1)

### Code Readiness
- [ ] All VOICE-0xx and E4/E5 items closed and tested
- [ ] VOICE-074 load tests pass (24/24)
- [ ] Failing test rate < 2% on CI/CD
- [ ] Code coverage for voice paths ≥ 75%
- [ ] No high/critical security issues in voice routes

### Database
- [ ] All migrations applied without errors
- [ ] `call_sessions`, `call_events`, `call_outbox_events` tables verified
- [ ] Backup taken before voice feature enabled
- [ ] Rollback migration tested locally

### Configuration
- [ ] `CALLS_PROVIDER=mock` confirmed (no real provider yet)
- [ ] `CALLS_WEBHOOK_SECRET` generated via secure method
- [ ] `CALLS_WEBHOOK_MAX_SKEW_SECONDS=300` set
- [ ] `CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE=false` confirmed
- [ ] `CALLS_OUTBOX_PROCESSING_RECOVERY_SECONDS=300` set

### Feature Flags
- [ ] `CALLS_ENABLED=true`
- [ ] `CALLS_AI_ENABLED=false` (for human-only pilot)
- [ ] `CALL_RECORDING_ENABLED=false` (for early pilot)
- [ ] `CALL_TRANSCRIPTION_ENABLED=false` (for early pilot)

### Operations
- [ ] Runbook reviewed by ops team
- [ ] On-call engineer trained on playbooks
- [ ] Escalation path defined
- [ ] Monitoring dashboards deployed

---

## Pilot Execution Plan (VOICE-075 Part 2)

### Phase 1: Canary (Days 1-2)
**Scope**: Internal team only, 5-10 inbound/outbound calls

**Entry Criteria**:
- All pre-launch checks passed
- Team trained on pilot expectations
- Runbook printed/accessible

**Activities**:
1. Enable voice in staging with `CALLS_ENABLED=true`
2. Execute CRM E2E harness:
   ```powershell
   $env:APP_URL="https://staging.6esk.co.za"
   $env:CRM_CALLS_TICKET_ID="<internal-ticket-uuid>"
   npm run calls:crm-e2e
   ```
3. Run replay-window drill (ensure webhook protection works):
   ```powershell
   npm run calls:replay-drill
   ```
4. Manually test:
   - Create ticket in call mode
   - Verify call queued in outbox
   - Check recording stub (if enabled)
   - Verify audit trail redacts phone numbers
   - Check agent `/api/agent/v1/tickets/{id}/call-options` endpoint

**Exit Criteria**:
- 10/10 calls created successfully
- 0 webhook replay attacks detected
- Phone redaction present in audit logs
- No database errors in logs
- Selection_required flow tested with 2-number scenario

### Phase 2: Expanded Canary (Days 3-5)
**Scope**: Team + 3-5 external testing partners, 50+ calls

**Activities**:
1. Invite external testers (may be existing customers or partners)
2. Share testing guide:
   - Create ticket in call mode with multiple contact numbers
   - Verify selection UI requires explicit choice
   - Test manual dial override
   - Attempt AI call via `/api/agent/v1/actions`
3. Monitor dashboards daily:
   - Call creation rate
   - Outbox delivery rate (should approach 100% with mock)
   - Error rates < 5%
   - Webhook rejection rate < 2%

**Exit Criteria**:
- 50+ calls completed
- No unhandled exceptions in logs
- Outbox delivery rate ≥ 95%
- User feedback: "call feature works as expected"

### Phase 3: GA Rollout (Day 6+)
**Scope**: All customers, gradual rollout

**Activities**:
1. Set `CALLS_ENABLED=true` in production
2. Monitor every 15 minutes for first 2 hours, then hourly for 24 hours
3. Have rollback team on standby
4. Alert if error rate exceeds 5%

**Exit Criteria**:
- Production call creation rate matches expectations
- Outbox delivery stable
- Customer support tickets < 3/hour
- No performance regressions

---

## Automated Drill Scripts (VOICE-075 Part 3)

### Replay-Window Validation Drill

**Location**: `scripts/call-webhook-replay-drill.js` (existing)

**Purpose**: Verify HMAC signature + timestamp validation

**Running it**:
```powershell
$env:APP_URL="https://staging.6esk.co.za"
$env:CALLS_WEBHOOK_SECRET="<webhook-secret>"
npm run calls:replay-drill
```

**Expected Output**:
```
✓ Fresh signature: 200 OK
✓ Stale signature (6min old): 401 Unauthorized
✓ Invalid signature: 401 Unauthorized  
✓ Tampered timestamp: 401 Unauthorized
```

**Pass Threshold**: 4/4 checks pass

---

### Load Test Drill

**Location**: `tests/calls-load-and-capacity.test.ts` (VOICE-074)

**Purpose**: Stress test outbox delivery, retry logic, concurrency control

**Running it**:
```powershell
npm test -- calls-load-and-capacity.test.ts --run
```

**Expected Output**:
```
 PASS  tests/calls-load-and-capacity.test.ts (24 tests) 735ms
 ├ Load Testing (3 tests)
 ├ Capacity and Backpressure (3 tests)
 ├ Failure Injection and Recovery (3 tests)
 ├ Retry Logic Under Load (3 tests)
 ├ Observability Under Load (3 tests)
 ├ Webhook Replay Validation (3 tests)
 └ Outbox Retry Path (3 tests)
```

**Pass Threshold**: All 24 tests pass

---

### Full E2E CRM Drill

**Location**: `scripts/calls-crm-e2e.js` (existing)

**Purpose**: Validate entire call orchestration: options → initiate → delivery → lifecycle → transcript → review-writeback

**Running it**:
```powershell
$env:APP_URL="https://staging.6esk.co.za"
$env:CRM_CALLS_TICKET_ID="<staging-ticket-uuid>"
$env:SIXESK_AGENT_ID="<agent-int-id>"
$env:SIXESK_AGENT_KEY="<agent-key>"
npm run calls:crm-e2e
```

**Expected Output**:
```
✓ Call options retrieved: 1 candidate + selection not required
✓ Call initiated: queued → dialing → in_progress
✓ Recording attached
✓ Lifecycle events published
✓ Deduplication verified (retry with same idempotencyKey no-ops)
```

**Pass Threshold**: All steps complete without errors

---

### Outbox Retry Simulation

**Location**: `scripts/call-outbox-load-drill.js` (existing)

**Purpose**: Exercise failed event recovery and backoff logic

**Running it**:
```powershell
$env:APP_URL="https://staging.6esk.co.za"
$env:CALLS_PROVIDER="twilio"  # Trigger failures (unconfigured)
npm run calls:outbox -- --limit 50 --loops 5
```

**Expected Behavior**:
1. First run: 50 events created, all fail (twilio unconfigured)
2. Second run: Events marked as failures, scheduled for retry
3. Third run: Retry logic kicks in, respects backoff window
4. After fix (`CALLS_PROVIDER=mock`): Retried events deliver successfully

---

## Health Dashboards & Monitoring (VOICE-075 Part 4)

### Real-Time Metrics to Track (Prod)

**Dashboard 1: Call Volume**
- Metric: Calls created (inbound + outbound) per 5min
- Alert: Drop > 50% below baseline → page on-call
- Query:
  ```sql
  SELECT COUNT(*) as calls, date_trunc('5 minute', created_at) as bucket
  FROM call_sessions
  WHERE created_at > now() - interval '24 hours'
  GROUP BY bucket ORDER BY bucket DESC;
  ```

**Dashboard 2: Outbox Health**
- Metric: Events queued vs delivered vs failed per 5min
- Alert: Failed rate > 5% for 15min → warning
- Query:
  ```sql
  SELECT 
    status, COUNT(*) as count,
    date_trunc('5 minute', updated_at) as bucket
  FROM call_outbox_events
  WHERE updated_at > now() - interval '24 hours'
  GROUP BY status, bucket ORDER BY bucket DESC;
  ```

**Dashboard 3: Webhook Health**
- Metric: Webhook rejection rate (401/403 vs success)
- Alert: Rejection rate > 2% for 1 hour → warning
- Query:
  ```sql
  SELECT 
    status_code, COUNT(*) as count
  FROM audit_logs
  WHERE action = 'webhook_rejected' AND created_at > now() - interval '24 hours'
  GROUP BY status_code;
  ```

**Dashboard 4: Error Rates**
- Metric: Errors by call session status (failed, no_answer, busy, canceled)
- Alert: Any single category > 30% of total → investigate

---

## Incident Response (VOICE-075 Part 5)

### Scenario 1: Call Creation Spike (Error Rate > 5%)

**Detection**: Monitoring alert within 5 minutes

**Immediate Response (0-5min)**:
1. Page on-call engineer
2. Check logs for error pattern:
   ```powershell
   # Find top error in last 5 minutes
   Select-String -Path "logs/*.log" -Pattern "ERROR.*call" | % { $_.Line } | Sort | Uniq -c | Sort -Descending | Select -First 5
   ```
3. Determine if error is:
   - **Database**: Check DB connection pool, query latency
   - **Provider**: Check provider status page (mock is always up)
   - **Auth**: Check webhook HMAC key rotation or timeout
   - **Configuration**: Check env var drift

**Investigation (5-15min)**:
1. Check recent deployments:
   ```powershell
   git log --oneline -10
   ```
2. Verify env vars match checklist above
3. Run diagnostics:
   ```powershell
   npm run calls:replay-drill
   npm test -- calls-outbox-failure.test.ts --run
   ```

**Remediation**:
- If DB: Run migrations, restart app
- If auth: Verify `CALLS_WEBHOOK_SECRET`, restart
- If config: Fix env var, redeploy

**Follow-up (Post-incident)**:
- Review root cause
- Add to runbook if systemic
- Improve monitoring

---

### Scenario 2: Webhook Replay Detected (401 Rejections Up 10x)

**Detection**: Alert: rejection rate > 2%

**Immediate Response**:
1. Enable verbose webhook logging:
   ```powershell
   $env:DEBUG="calls:webhook"
   ```
2. Check suspected attacker IP:
   ```powershell
   # See most common IPs in webhook rejections
   Select-String -Path "logs/*.log" -Pattern "401.*webhook" | % { $_.Line } | Sort | Uniq -c | Sort -Descending | Select -First 5
   ```
3. If rate persists > 15min: Enable temporary IP block in WAF/proxy

**Remediation**:
1. Rotate webhook secret (breaking change for Venus):
   ```powershell
   # Generate new secret
   $newSecret = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString()))
   # Update env
   $env:CALLS_WEBHOOK_SECRET = $newSecret
   ```
2. Notify Venus team of new secret
3. Monitor rejection rate returns to < 2%

---

### Scenario 3: Outbox Queue Backlog (> 5000 failed events)

**Detection**: Alert, or manual check:
```powershell
Invoke-RestMethod -Method GET -Uri "https://6esk.co.za/api/admin/calls/failed?limit=1" -Headers @{ "Cookie" = "<admin_session>" }
```

**Triage**:
1. Get count of failed events:
   ```sql
   SELECT COUNT(*) as failedCount FROM call_outbox_events WHERE status = 'failed';
   ```
2. Check error distribution:
   ```sql
   SELECT last_error_code, COUNT(*) FROM call_outbox_events WHERE status = 'failed' GROUP BY last_error_code;
   ```

**By Error Type**:
- **`provider_unavailable`** (Twilio down): Wait 15min, retry manually
- **`invalid_phone`** (bad format): Dead-letter manually, fix source
- **`rate_limited`** (too many calls): Increase rate limit or wait
- **`unknown`** (catch-all): Check logs for root cause, escalate

**Recovery**:
1. Retry failed events:
   ```powershell
   Invoke-RestMethod -Method POST -Uri "https://6esk.co.za/api/admin/calls/retry?limit=100" -Headers @{ "x-6esk-secret" = "<maintenance-secret>" }
   ```
2. Run outbox worker:
   ```powershell
   npm run calls:outbox
   ```
3. Verify backlog decreasing:
   ```sql
   SELECT status, COUNT(*) FROM call_outbox_events GROUP BY status;
   ```

---

## Emergency Rollback (VOICE-075 Part 6)

### Rollback Trigger Criteria
Rollback if ANY of these occur and persist > 30min:
- Call creation error rate > 10%
- Outbox delivery failure rate > 20%
- Webhook rejection rate > 5%
- Performance regression: avg response time +200ms
- Database deadlock or connection exhaustion

### Rollback Steps (Estimated 15-30 minutes)

**Step 1: Disable Voice Feature (Immediate)**
```powershell
$env:CALLS_ENABLED = "false"
# Redeploy or set runtime override
```

This silently treats new call requests as `not_configured` without error.

**Step 2: Stop Outbox Worker**
```powershell
# Kill process
Get-Process | Where-Object { $_.ProcessName -match "call-outbox" } | Stop-Process
```

Pending calls remain queued but won't attempt delivery.

**Step 3: Revert Code (if needed)**
```powershell
git revert <voice-feature-commit>
npm run build && npm start
```

**Step 4: Database Safeguard (optional)**
```sql
-- Archive in-flight data if health compromised
INSERT INTO archived_call_sessions 
SELECT * FROM call_sessions WHERE status NOT IN ('completed', 'failed');

-- Clear outbox to prevent cascade
DELETE FROM call_outbox_events WHERE status = 'queued' LIMIT 1000;
```

**Step 5: Communication**
- Post status on status page: "Voice feature temporarily offline"
- Notify affected customers (if any made calls in last 2 hours)
- Schedule post-mortem within 24 hours

### Rollback Verification
- Call create endpoint returns 503/feature disabled
- No new call_sessions created in 5 minutes
- Error rate returns to baseline
- Outbox queue stabilizes

### Re-Enable After Root Cause Fixed
1. Fix root cause (config/code/data)
2. Test in staging with full drill suite
3. Gradually re-enable (start with 10% traffic)
4. Monitor for 1 hour before full rollout

---

## Post-Pilot Checklist (VOICE-075 Part 7)

After successful pilot (3+ days at GA without rollback):

- [ ] Retrospective completed
- [ ] Monitoring dashboards tuned (alert thresholds optimized)
- [ ] Runbook refined based on actual issues
- [ ] Team knowledge documented
- [ ] Customer comms prepared
- [ ] Provider adapter (VOICE-033) scheduled if needed
- [ ] AI voice actions (VENUS-100-104) planned
- [ ] Recording + transcription (VOICE-044) scheduled
- [ ] Update architecture decision log

---

## Appendix: Reference Commands

### Utility Commands
```powershell
# Check call session status
SELECT status, COUNT(*) FROM call_sessions GROUP BY status;

# Verify redaction working
SELECT * FROM audit_logs WHERE data LIKE '%+1555%' LIMIT 1;

# Check agent integrations
SELECT id, name, capabilities FROM agent_integrations WHERE capabilities->>'allowVoiceActions' = 'true';

# Test webhook signature
$body = '{"test": true}'
$ts = (Get-Date -AsUTC).ToUnixTimeMilliseconds()
$hmacKey = [Text.Encoding]::UTF8.GetBytes($env:CALLS_WEBHOOK_SECRET)
$input = "$ts.$body"
$hmacsha256 = New-Object System.Security.Cryptography.HMACSHA256
$hmacsha256.Key = $hmacKey
$hash = [Convert]::ToBase64String($hmacsha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($input)))
Write-Output "sha256=$hash"
```

### Emergency Contacts
- On-call Engineer: [slack #oncall]
- CEO/Founder: [direct number]
- Provider (Twilio/etc): [support phone]
- Legal: [for incident disclosure]
