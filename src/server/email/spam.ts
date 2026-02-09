import { db } from "@/server/db";

type SpamRule = {
  id: string;
  rule_type: "allow" | "block";
  scope: "sender" | "domain" | "subject" | "body";
  pattern: string;
};

function getDomain(email: string) {
  const parts = email.split("@");
  return parts.length > 1 ? parts[1].toLowerCase() : "";
}

function matchesRule(
  rule: SpamRule,
  {
    fromEmail,
    subject,
    text
  }: { fromEmail: string; subject?: string | null; text?: string | null }
) {
  const pattern = rule.pattern.toLowerCase();
  const subjectText = subject?.toLowerCase() ?? "";
  const bodyText = text?.toLowerCase() ?? "";
  const sender = fromEmail.toLowerCase();
  const domain = getDomain(sender);

  switch (rule.scope) {
    case "sender":
      return sender.includes(pattern);
    case "domain":
      return domain === pattern || domain.endsWith(`.${pattern}`);
    case "subject":
      return subjectText.includes(pattern);
    case "body":
      return bodyText.includes(pattern);
    default:
      return false;
  }
}

export async function evaluateSpam({
  fromEmail,
  subject,
  text
}: {
  fromEmail: string;
  subject?: string | null;
  text?: string | null;
}) {
  const result = await db.query<SpamRule>(
    `SELECT id, rule_type, scope, pattern
     FROM spam_rules
     WHERE is_active = true`
  );
  const rules = result.rows;

  const allowRules = rules.filter((rule) => rule.rule_type === "allow");
  const blockRules = rules.filter((rule) => rule.rule_type === "block");

  for (const rule of allowRules) {
    if (matchesRule(rule, { fromEmail, subject, text })) {
      return { isSpam: false, reason: `allow:${rule.id}` };
    }
  }

  for (const rule of blockRules) {
    if (matchesRule(rule, { fromEmail, subject, text })) {
      return { isSpam: true, reason: `block:${rule.id}` };
    }
  }

  return { isSpam: false, reason: null };
}
