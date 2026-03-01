const crypto = require("crypto");
const { Client } = require("pg");

const {
  APP_URL,
  CALLS_WEBHOOK_SECRET,
  SIXESK_AGENT_ID,
  SIXESK_AGENT_KEY,
  CRM_CALLS_TICKET_ID,
  CRM_CALLS_REASON,
  CRM_CALLS_IDEMPOTENCY_KEY,
  CRM_CALLS_TO_PHONE,
  CRM_CALLS_CANDIDATE_ID,
  CRM_CALLS_FROM_PHONE,
  CRM_CALLS_VENUS_EVENTS_URL,
  CRM_CALLS_VENUS_EVENTS_TOKEN,
  DATABASE_URL
} = process.env;

const REQUIRED = [
  "APP_URL",
  "CALLS_WEBHOOK_SECRET",
  "SIXESK_AGENT_ID",
  "SIXESK_AGENT_KEY",
  "CRM_CALLS_TICKET_ID"
];

function missingEnv() {
  const missing = [];
  for (const key of REQUIRED) {
    if (!process.env[key] || !String(process.env[key]).trim()) {
      missing.push(key);
    }
  }
  return missing;
}

function baseUrl() {
  return APP_URL.replace(/\/+$/, "");
}

function nowTimestampSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

function signWebhook(timestamp, rawBody) {
  const payload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac("sha256", CALLS_WEBHOOK_SECRET).update(payload).digest("hex");
  return `sha256=${digest}`;
}

function parseJsonOrNull(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: parseJsonOrNull(text)
  };
}

function agentHeaders() {
  return {
    "content-type": "application/json",
    "x-6esk-agent-id": SIXESK_AGENT_ID,
    "x-6esk-agent-key": SIXESK_AGENT_KEY
  };
}

function checkCallOptionsShape(payload) {
  if (!payload || typeof payload !== "object") {
    return "Response body must be an object.";
  }
  if (typeof payload.selectionRequired !== "boolean") {
    return "`selectionRequired` must be boolean.";
  }
  const hasDefault = payload.defaultCandidateId == null || typeof payload.defaultCandidateId === "string";
  if (!hasDefault) {
    return "`defaultCandidateId` must be string|null.";
  }
  if (!Array.isArray(payload.candidates)) {
    return "`candidates` must be an array.";
  }
  for (const candidate of payload.candidates) {
    if (!candidate || typeof candidate !== "object") {
      return "Each candidate must be an object.";
    }
    if (!candidate.candidateId || typeof candidate.candidateId !== "string") {
      return "Each candidate requires `candidateId`.";
    }
    if (!candidate.phone || typeof candidate.phone !== "string") {
      return "Each candidate requires `phone`.";
    }
    if (!candidate.source || typeof candidate.source !== "string") {
      return "Each candidate requires `source`.";
    }
  }
  return null;
}

function assertActionResult(payload, type) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Action response body is invalid.");
  }
  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    throw new Error("Action response has no results.");
  }
  const first = payload.results[0];
  if (!first || first.type !== type) {
    throw new Error(`Expected first action result type '${type}'.`);
  }
  return first;
}

async function sendStatusWebhook(callSessionId, status, durationSeconds) {
  const timestamp = nowTimestampSeconds();
  const body = JSON.stringify({
    callSessionId,
    provider: "crm-e2e",
    status,
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    durationSeconds: durationSeconds == null ? undefined : durationSeconds
  });
  return fetchJson(`${baseUrl()}/api/calls/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-6esk-timestamp": timestamp,
      "x-6esk-signature": signWebhook(timestamp, body)
    },
    body
  });
}

async function sendTranscriptWebhook(callSessionId, transcriptText) {
  const timestamp = nowTimestampSeconds();
  const body = JSON.stringify({
    callSessionId,
    provider: "crm-e2e",
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    transcriptText
  });
  return fetchJson(`${baseUrl()}/api/calls/transcript`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-6esk-timestamp": timestamp,
      "x-6esk-signature": signWebhook(timestamp, body)
    },
    body
  });
}

function formatCheckResult(name, passed, detail) {
  const prefix = passed ? "PASS" : "FAIL";
  return `${prefix}: ${name}${detail ? ` -> ${detail}` : ""}`;
}

function normalizeVenusEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.events)) return payload.events;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return null;
}

function readEventType(item) {
  if (!item || typeof item !== "object") return null;
  return item.event_type || item.eventType || item.type || null;
}

function readEventCallSessionId(item) {
  if (!item || typeof item !== "object") return null;
  const call = item.call;
  if (call && typeof call === "object" && typeof call.id === "string") {
    return call.id;
  }
  if (typeof item.callSessionId === "string") return item.callSessionId;
  if (typeof item.call_session_id === "string") return item.call_session_id;
  return null;
}

function readEventSequence(item) {
  if (!item || typeof item !== "object") return null;
  const call = item.call;
  if (call && typeof call === "object") {
    const seq = Number(call.sequence);
    if (Number.isFinite(seq)) return seq;
  }
  const seq = Number(item.sequence);
  if (Number.isFinite(seq)) return seq;
  return null;
}

async function verifyLocalAgentOutboxSequence(callSessionId) {
  if (!DATABASE_URL) {
    return {
      skipped: true,
      detail: "DATABASE_URL not set; skipped local sequence verification."
    };
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT event_type, payload, created_at
       FROM agent_outbox
       WHERE event_type LIKE 'ticket.call.%'
         AND payload->'call'->>'id' = $1
       ORDER BY created_at ASC`,
      [callSessionId]
    );
    if (!result.rows.length) {
      return {
        passed: false,
        detail: "No ticket.call.* rows found in agent_outbox for call session."
      };
    }

    let lastSequence = 0;
    for (const row of result.rows) {
      const payload = row.payload || {};
      const call = payload.call || {};
      const sequence = Number(call.sequence);
      const key = call.eventIdempotencyKey;
      if (!Number.isFinite(sequence) || sequence < 1) {
        return {
          passed: false,
          detail: `Missing/invalid call.sequence for ${row.event_type}.`
        };
      }
      if (sequence <= lastSequence) {
        return {
          passed: false,
          detail: `Non-monotonic call.sequence (${sequence} after ${lastSequence}).`
        };
      }
      if (typeof key !== "string" || key !== `${callSessionId}:${sequence}`) {
        return {
          passed: false,
          detail: `Invalid eventIdempotencyKey for ${row.event_type}.`
        };
      }
      lastSequence = sequence;
    }
    return {
      passed: true,
      detail: `Validated ${result.rows.length} local ticket.call.* events with monotonic sequence.`
    };
  } finally {
    await client.end();
  }
}

async function verifyVenusObservation(callSessionId) {
  if (!CRM_CALLS_VENUS_EVENTS_URL) {
    return {
      skipped: true,
      detail: "CRM_CALLS_VENUS_EVENTS_URL not set; skipped Venus observation check."
    };
  }

  const url = new URL(CRM_CALLS_VENUS_EVENTS_URL);
  url.searchParams.set("callSessionId", callSessionId);

  const headers = {};
  if (CRM_CALLS_VENUS_EVENTS_TOKEN) {
    headers.Authorization = `Bearer ${CRM_CALLS_VENUS_EVENTS_TOKEN}`;
  }

  const response = await fetchJson(url.toString(), { headers });
  if (!response.ok || !response.json) {
    return {
      passed: false,
      detail: `Venus events endpoint returned ${response.status}.`
    };
  }

  const events = normalizeVenusEvents(response.json);
  if (!events) {
    return {
      passed: false,
      detail: "Venus events payload did not contain an events array."
    };
  }

  const callEvents = events.filter((item) => readEventCallSessionId(item) === callSessionId);
  if (!callEvents.length) {
    return {
      passed: false,
      detail: "No Venus events matched callSessionId."
    };
  }

  const requiredTypes = [
    "ticket.call.queued",
    "ticket.call.started",
    "ticket.call.ended",
    "ticket.call.transcript.ready"
  ];
  const seenTypes = new Set(callEvents.map((item) => readEventType(item)).filter(Boolean));
  for (const required of requiredTypes) {
    if (!seenTypes.has(required)) {
      return {
        passed: false,
        detail: `Venus missing required event type '${required}'.`
      };
    }
  }

  let lastSequence = 0;
  for (const item of callEvents) {
    const sequence = readEventSequence(item);
    if (sequence == null) {
      continue;
    }
    if (sequence <= lastSequence) {
      return {
        passed: false,
        detail: `Venus observed non-monotonic sequence (${sequence} after ${lastSequence}).`
      };
    }
    lastSequence = sequence;
  }

  return {
    passed: true,
    detail: `Venus observed ${callEvents.length} events for call session.`
  };
}

async function main() {
  const missing = missingEnv();
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const checks = [];
  const defaultReason = "CRM_CALLS staging orchestration check";
  const reason = (CRM_CALLS_REASON || defaultReason).trim();
  const idempotencySeed =
    (CRM_CALLS_IDEMPOTENCY_KEY || `crm-e2e-${Date.now()}`).trim() || `crm-e2e-${Date.now()}`;
  const ticketId = CRM_CALLS_TICKET_ID.trim();

  const callOptionsResponse = await fetchJson(
    `${baseUrl()}/api/agent/v1/tickets/${ticketId}/call-options`,
    {
      method: "GET",
      headers: agentHeaders()
    }
  );
  if (!callOptionsResponse.ok || !callOptionsResponse.json) {
    throw new Error(`Call-options request failed (${callOptionsResponse.status})`);
  }
  const callOptionsError = checkCallOptionsShape(callOptionsResponse.json);
  if (callOptionsError) {
    throw new Error(`Call-options shape invalid: ${callOptionsError}`);
  }
  checks.push(formatCheckResult("Call options shape and candidates", true));

  const initiateAction = {
    type: "initiate_call",
    ticketId,
    reason,
    idempotencyKey: idempotencySeed,
    metadata: {
      workflowId: `crm-e2e-${Date.now()}`
    }
  };

  if (CRM_CALLS_CANDIDATE_ID && CRM_CALLS_CANDIDATE_ID.trim()) {
    initiateAction.candidateId = CRM_CALLS_CANDIDATE_ID.trim();
  } else if (CRM_CALLS_TO_PHONE && CRM_CALLS_TO_PHONE.trim()) {
    initiateAction.toPhone = CRM_CALLS_TO_PHONE.trim();
  }
  if (CRM_CALLS_FROM_PHONE && CRM_CALLS_FROM_PHONE.trim()) {
    initiateAction.fromPhone = CRM_CALLS_FROM_PHONE.trim();
  }

  const firstInitiate = await fetchJson(`${baseUrl()}/api/agent/v1/actions`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ action: initiateAction })
  });
  if (!firstInitiate.ok || !firstInitiate.json) {
    throw new Error(`initiate_call request failed (${firstInitiate.status})`);
  }
  const firstResult = assertActionResult(firstInitiate.json, "initiate_call");
  if (firstResult.status !== "ok") {
    throw new Error(
      `initiate_call returned '${firstResult.status}' (${firstResult.detail || "no detail"})`
    );
  }
  const firstData = firstResult.data || {};
  const callSessionId = firstData.callSessionId;
  if (!callSessionId || typeof callSessionId !== "string") {
    throw new Error("initiate_call response missing callSessionId.");
  }
  checks.push(formatCheckResult("Initiate call deterministic status", true, `callSessionId=${callSessionId}`));

  const duplicateInitiate = await fetchJson(`${baseUrl()}/api/agent/v1/actions`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ action: initiateAction })
  });
  if (!duplicateInitiate.ok || !duplicateInitiate.json) {
    throw new Error(`duplicate initiate_call request failed (${duplicateInitiate.status})`);
  }
  const duplicateResult = assertActionResult(duplicateInitiate.json, "initiate_call");
  if (duplicateResult.status !== "ok") {
    throw new Error(`duplicate initiate_call returned '${duplicateResult.status}'.`);
  }
  const duplicateData = duplicateResult.data || {};
  if (duplicateData.callSessionId !== callSessionId || duplicateData.idempotent !== true) {
    throw new Error("Duplicate initiate_call did not return same session with idempotent=true.");
  }
  checks.push(formatCheckResult("Duplicate initiate-call idempotency", true));

  const started = await sendStatusWebhook(callSessionId, "in_progress");
  if (!started.ok) {
    throw new Error(`status=in_progress webhook failed (${started.status}).`);
  }
  const ended = await sendStatusWebhook(callSessionId, "completed", 45);
  if (!ended.ok) {
    throw new Error(`status=completed webhook failed (${ended.status}).`);
  }
  checks.push(formatCheckResult("Lifecycle status webhooks", true));

  const transcript = await sendTranscriptWebhook(
    callSessionId,
    "CRM E2E transcript: customer asked for resolution timeline and escalation."
  );
  if (!transcript.ok || !transcript.json || transcript.json.status !== "attached") {
    throw new Error(`Transcript webhook failed (${transcript.status}).`);
  }
  checks.push(formatCheckResult("Transcript webhook handling", true));

  const reviewAction = {
    type: "request_human_review",
    ticketId,
    idempotencyKey: `${idempotencySeed}:summary`,
    metadata: {
      source: "crm-calls-e2e",
      callSessionId,
      summary: "Customer requested payout timeline and escalation support.",
      actionItems: ["Escalate to specialist queue", "Send ETA update"]
    }
  };
  const reviewFirst = await fetchJson(`${baseUrl()}/api/agent/v1/actions`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ action: reviewAction })
  });
  if (!reviewFirst.ok || !reviewFirst.json) {
    throw new Error(`First request_human_review failed (${reviewFirst.status}).`);
  }
  const reviewFirstResult = assertActionResult(reviewFirst.json, "request_human_review");
  if (reviewFirstResult.status !== "ok" || reviewFirstResult.data?.deduplicated !== false) {
    throw new Error("First request_human_review did not report deduplicated=false.");
  }
  const reviewDuplicate = await fetchJson(`${baseUrl()}/api/agent/v1/actions`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ action: reviewAction })
  });
  if (!reviewDuplicate.ok || !reviewDuplicate.json) {
    throw new Error(`Duplicate request_human_review failed (${reviewDuplicate.status}).`);
  }
  const reviewDuplicateResult = assertActionResult(reviewDuplicate.json, "request_human_review");
  if (reviewDuplicateResult.status !== "ok" || reviewDuplicateResult.data?.deduplicated !== true) {
    throw new Error("Duplicate request_human_review did not report deduplicated=true.");
  }
  checks.push(formatCheckResult("Transcript summary writeback idempotency", true));

  const localSequence = await verifyLocalAgentOutboxSequence(callSessionId);
  if (localSequence.skipped) {
    checks.push(formatCheckResult("Local sequence verification", true, localSequence.detail));
  } else if (localSequence.passed) {
    checks.push(formatCheckResult("Local sequence verification", true, localSequence.detail));
  } else {
    checks.push(formatCheckResult("Local sequence verification", false, localSequence.detail));
  }

  const venusObservation = await verifyVenusObservation(callSessionId);
  if (venusObservation.skipped) {
    checks.push(formatCheckResult("Venus observation check", true, venusObservation.detail));
  } else if (venusObservation.passed) {
    checks.push(formatCheckResult("Venus observation check", true, venusObservation.detail));
  } else {
    checks.push(formatCheckResult("Venus observation check", false, venusObservation.detail));
  }

  console.log("CRM Calls staging E2E summary");
  for (const line of checks) {
    console.log(`- ${line}`);
  }

  const failures = checks.filter((line) => line.startsWith("FAIL:"));
  if (failures.length > 0) {
    throw new Error(`CRM Calls staging E2E failed (${failures.length} failed check(s)).`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
