export function hasMailboxScope(
  integration: { scopes: Record<string, unknown> },
  mailboxId: string | null
) {
  if (!mailboxId) return false;
  const scopes = integration.scopes ?? {};
  const mailboxIds = Array.isArray((scopes as { mailbox_ids?: unknown }).mailbox_ids)
    ? ((scopes as { mailbox_ids: string[] }).mailbox_ids as string[])
    : [];
  if (mailboxIds.length === 0) {
    return true;
  }
  return mailboxIds.includes(mailboxId);
}
