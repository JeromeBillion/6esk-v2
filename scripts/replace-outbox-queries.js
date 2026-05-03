const fs = require('fs');

function updateLockQuery(filePath, tableName, moduleKey) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  const searchRegex = new RegExp(
    `SELECT id\\r?\\n\\s+FROM ${tableName}\\r?\\n\\s+WHERE direction = 'outbound'\\r?\\n\\s+AND \\(\\r?\\n\\s+\\(status = 'queued' AND next_attempt_at <= now\\(\\)\\)\\r?\\n\\s+OR \\(\\r?\\n\\s+status = 'processing'\\r?\\n\\s+AND updated_at <= now\\(\\) - make_interval\\(secs => \\$2::int\\)\\r?\\n\\s+\\)\\r?\\n\\s+\\)\\r?\\n\\s+ORDER BY created_at ASC`
  );

  const replacement = `SELECT e.id
         FROM ${tableName} e
         JOIN workspace_modules wm ON wm.tenant_id = e.tenant_id AND wm.workspace_key = 'primary'
         WHERE e.direction = 'outbound'
           AND (wm.modules->>'${moduleKey}')::boolean = true
           AND (
             (e.status = 'queued' AND e.next_attempt_at <= now())
             OR (
               e.status = 'processing'
               AND e.updated_at <= now() - make_interval(secs => $2::int)
             )
           )
         ORDER BY e.created_at ASC`;

  content = content.replace(searchRegex, replacement);
  fs.writeFileSync(filePath, content);
}

// WhatsApp
updateLockQuery('src/server/whatsapp/outbox.ts', 'whatsapp_events', 'whatsapp');

// Email
updateLockQuery('src/server/email/outbox.ts', 'email_outbox_events', 'email');

// Calls
updateLockQuery('src/server/calls/outbox.ts', 'call_outbox_events', 'voice');

console.log("Done queries");
