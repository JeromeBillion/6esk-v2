const fs = require('fs');

// Fix email outbox
const emailFile = 'src/server/email/outbox.ts';
let emailContent = fs.readFileSync(emailFile, 'utf8');
emailContent = emailContent.replace(
  /export async function enqueueEmailOutboxEvent\(payload: Record<string, unknown>\) \{\r?\n\s+const result = await db\.query<\{ id: string \}>\(\r?\n\s+`INSERT INTO email_outbox_events \(direction, payload, status\)\r?\n\s+VALUES \('outbound', \$1::jsonb, 'queued'\)\r?\n\s+RETURNING id`,\r?\n\s+\[payload\]\r?\n\s+\);\r?\n\s+return result\.rows\[0\]\?\.id \?\? null;\r?\n\}/,
  `export async function enqueueEmailOutboxEvent(payload: Record<string, unknown>, tenantId?: string) {
  const finalTenantId = tenantId || "00000000-0000-0000-0000-000000000001";
  const result = await db.query<{ id: string }>(
    \`INSERT INTO email_outbox_events (tenant_id, direction, payload, status)
     VALUES ($1, 'outbound', $2::jsonb, 'queued')
     RETURNING id\`,
    [finalTenantId, payload]
  );
  return result.rows[0]?.id ?? null;
}`
);
fs.writeFileSync(emailFile, emailContent);

// Fix calls service
const callFile = 'src/server/calls/service.ts';
let callContent = fs.readFileSync(callFile, 'utf8');
callContent = callContent.replace(
  /t\.id,\r?\n\s+t\.mailbox_id,/,
  't.id,\n       t.tenant_id,\n       t.mailbox_id,'
);

callContent = callContent.replace(
  /await client\.query\(\r?\n\s+`INSERT INTO call_outbox_events \(direction, payload, status\)\r?\n\s+VALUES \('outbound', \$1, 'queued'\)`,\r?\n\s+\[\r?\n\s+\{\r?\n\s+callSessionId,/,
  `await client.query(
      \`INSERT INTO call_outbox_events (tenant_id, direction, payload, status)
       VALUES ($1, 'outbound', $2, 'queued')\`,
      [
        (ticket as any).tenant_id || "00000000-0000-0000-0000-000000000001",
        {
          callSessionId,`
);
fs.writeFileSync(callFile, callContent);

console.log("Done");
