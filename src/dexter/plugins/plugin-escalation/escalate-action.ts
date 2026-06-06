import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type HandlerOptions,
  type ActionResult,
  logger,
} from '@elizaos/core';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PROFILE_SOURCE = 'prediction-market-mvp-webchat';

type IdentityDetails = {
  email: string | null;
  name: string | null;
  isAuthenticated: boolean;
  externalProfile: Record<string, unknown> | null;
  profileLookup: Record<string, unknown> | null;
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/**
 * Extract the most recent email address typed by the user from the
 * conversation transcript.  We walk the lines in reverse so the
 * "freshest" email wins (the one the user just gave us).
 */
function extractEmail(text: string): string | null {
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    // Skip agent lines — only look at user lines
    if (/^Dexter/i.test(line.trim())) continue;
    const match = line.match(EMAIL_RE);
    if (match) return match[0].toLowerCase();
  }
  // Fallback: any email in the conversation
  const all = text.match(EMAIL_RE);
  return all ? all[all.length - 1].toLowerCase() : null;
}

/**
 * Best-effort name extraction from patterns like
 * "I'm John", "my name is Jane Doe", "name: Alex", "it's Sipho", etc.
 */
function extractName(text: string): string | null {
  const patterns = [
    /(?:(?:i'?m|my name is|i am|name:?|it'?s|this is|call me)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    if (/^Dexter/i.test(line.trim())) continue;
    for (const re of patterns) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
  }
  return null;
}

function buildIdentityFromMetadata(message: Memory): IdentityDetails {
  const metadata = parseMetadata(message.content?.metadata);
  if (!metadata) {
    return {
      email: null,
      name: null,
      isAuthenticated: false,
      externalProfile: null,
      profileLookup: null,
    };
  }

  const isAuthenticated = metadata.isAuthenticated === true;
  const email = normalizeEmail(readStringField(metadata, 'appUserEmail'));
  const name = readStringField(metadata, 'appUserFullName');
  const secondaryEmail = normalizeEmail(readStringField(metadata, 'appUserSecondaryEmail'));
  const phoneNumber = readStringField(metadata, 'appUserPhone');
  const kycStatus = readStringField(metadata, 'appUserKycStatus');
  const accountStatus = readStringField(metadata, 'appUserAccountStatus');
  const externalUserId = readStringField(metadata, 'appUserId');
  const matchedAt = new Date().toISOString();

  if (!isAuthenticated || !email) {
    return {
      email: email ?? null,
      name,
      isAuthenticated,
      externalProfile: null,
      profileLookup: null,
    };
  }

  return {
    email,
    name,
    isAuthenticated: true,
    externalProfile: {
      source: PROFILE_SOURCE,
      externalUserId,
      matchedBy: 'session_auth',
      matchedAt,
      fullName: name,
      email,
      secondaryEmail,
      phoneNumber,
      kycStatus,
      accountStatus,
    },
    profileLookup: {
      source: PROFILE_SOURCE,
      status: 'matched',
      lookupAt: matchedAt,
      matchedBy: 'session_auth',
    },
  };
}

/**
 * Build a plain-text conversation transcript suitable for the ticket
 * description.  Keeps only the last ~20 messages so it doesn't blow
 * up the ticket body.
 */
function buildTranscript(recentMessages: string): string {
  const lines = recentMessages.split('\n').filter((l) => l.trim().length > 0);
  const kept = lines.slice(-40); // generous limit, pairs ≈ 20 turns
  return kept.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export const escalateToHumanAction: Action = {
  name: 'ESCALATE_TO_HUMAN',
  similes: ['CREATE_TICKET', 'SPEAK_TO_HUMAN', 'HUMAN_HANDOFF', 'TALK_TO_AGENT'],
  description:
    'Creates a support ticket on 6esk when the user wants to speak to a human agent. ' +
    "Requires the user's email (and ideally name + issue summary) to have been collected " +
    'in the conversation before this action fires.',

  /* ---- validate ---- */
  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const baseUrl = runtime.getSetting('SIXESK_BASE_URL');
    const secret = runtime.getSetting('SIXESK_INBOUND_SECRET');
    return !!(baseUrl && secret);
  },

  /* ---- handler ---- */
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const baseUrl = (runtime.getSetting('SIXESK_BASE_URL') as string) || '';
    const inboundSecret = (runtime.getSetting('SIXESK_INBOUND_SECRET') as string) || '';
    const legacyRecentMessages = (state as Record<string, unknown> | undefined)?.recentMessages;
    const valuesRecentMessages = (state?.values as Record<string, unknown> | undefined)
      ?.recentMessages;
    const recentMessages =
      (typeof valuesRecentMessages === 'string' && valuesRecentMessages) ||
      (typeof legacyRecentMessages === 'string' && legacyRecentMessages) ||
      '';
    const metadataIdentity = buildIdentityFromMetadata(message);

    // ---- extract info ----
    const email = metadataIdentity.email || extractEmail(recentMessages);
    const name = metadataIdentity.name || extractName(recentMessages) || 'Webchat User';

    if (!email) {
      // Missing email — ask again via callback
      if (callback) {
        await callback({
          text: "I'd like to create a ticket for you, but I still need your email address so our support team can reach you. Could you share it?",
          actions: ['ESCALATE_TO_HUMAN'],
        });
      }
      return {
        success: false,
        text: 'Email not found in conversation — prompted user again.',
        data: { actionName: 'ESCALATE_TO_HUMAN', error: 'missing_email' },
      };
    }

    // ---- build ticket ----
    const transcript = buildTranscript(recentMessages);
    const userMessage = message.content?.text || '';
    const subject = `Dexter webchat: ${name} requests human support`;
    const description = [
      `**Escalation from Dexter webchat**`,
      '',
      `**Customer name:** ${name}`,
      `**Customer email:** ${email}`,
      '',
      `**Latest message:** ${userMessage}`,
      '',
      '---',
      '**Conversation transcript:**',
      '',
      transcript,
    ].join('\n');

    // ---- POST to 6esk ----
    try {
      const res = await fetch(`${baseUrl}/api/tickets/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-6esk-secret': inboundSecret,
        },
        body: JSON.stringify({
          from: email,
          subject,
          description,
          category: 'general',
          tags: ['Dexter-escalation', 'webchat'],
          metadata: {
            source: 'Dexter-webchat',
            authState: metadataIdentity.isAuthenticated ? 'authenticated' : 'guest',
            customerName: name,
            customerEmail: email,
            escalatedAt: new Date().toISOString(),
            ...(metadataIdentity.externalProfile
              ? {
                  external_profile: metadataIdentity.externalProfile,
                  profile_lookup: metadataIdentity.profileLookup,
                }
              : {}),
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error(
          { src: 'escalation', status: res.status, body: errText },
          'Failed to create ticket on 6esk'
        );

        if (callback) {
          await callback({
            text: "I'm sorry, I wasn't able to create a ticket right now. Please email support@6ex.co.za directly and a support agent will assist you.",
            actions: ['ESCALATE_TO_HUMAN'],
          });
        }
        return {
          success: false,
          text: 'Ticket creation failed',
          data: { actionName: 'ESCALATE_TO_HUMAN', error: errText },
        };
      }

      const result = (await res.json()) as { ticketId?: string; status?: string };
      logger.info(
        { src: 'escalation', ticketId: result.ticketId, email },
        'Ticket created on 6esk from webchat escalation'
      );

      if (callback) {
        await callback({
          text: `I've created a support ticket for you. A support agent will contact you at ${email} shortly. Is there anything else I can help you with in the meantime?`,
          actions: ['ESCALATE_TO_HUMAN'],
        });
      }

      return {
        success: true,
        text: `Ticket created: ${result.ticketId}`,
        values: { ticketId: result.ticketId, email, name },
        data: {
          actionName: 'ESCALATE_TO_HUMAN',
          ticketId: result.ticketId,
          email,
          name,
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ src: 'escalation', error: errMsg }, '6esk ticket creation threw');

      if (callback) {
        await callback({
          text: "I'm sorry, something went wrong while creating your ticket. Please email support@6ex.co.za directly and our team will help you.",
          actions: ['ESCALATE_TO_HUMAN'],
        });
      }

      return {
        success: false,
        text: 'Ticket creation error',
        data: { actionName: 'ESCALATE_TO_HUMAN', error: errMsg },
        error: err instanceof Error ? err : new Error(errMsg),
      };
    }
  },

  /* ---- examples ---- */
  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'I want to speak to a real person' },
      },
      {
        name: 'Dexter',
        content: {
          text: "I'd be happy to connect you with a support agent! To create a ticket I'll need:\n1. Your full name\n2. Your email address\n3. A brief description of your issue",
          actions: ['REPLY'],
        },
      },
      {
        name: '{{user1}}',
        content: { text: "I'm Sipho, sipho@example.com, I can't withdraw my funds" },
      },
      {
        name: 'Dexter',
        content: {
          text: "Thanks Sipho! I've created a support ticket for you. A support agent will contact you at sipho@example.com shortly.",
          actions: ['ESCALATE_TO_HUMAN'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Let me talk to a human agent please' },
      },
      {
        name: 'Dexter',
        content: {
          text: "Sure! I'll create a support ticket so a human agent can assist you. Could you please share your name, email address, and what you need help with?",
          actions: ['REPLY'],
        },
      },
      {
        name: '{{user1}}',
        content: { text: 'Thandi, thandi@mail.co.za. My KYC has been pending for a week.' },
      },
      {
        name: 'Dexter',
        content: {
          text: "Thanks Thandi! I've created a support ticket for you. A support agent will contact you at thandi@mail.co.za shortly. Is there anything else I can help with in the meantime?",
          actions: ['ESCALATE_TO_HUMAN'],
        },
      },
    ],
  ],
};
