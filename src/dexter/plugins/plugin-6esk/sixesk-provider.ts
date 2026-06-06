import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type ProviderResult,
  addHeader,
} from '@elizaos/core';
import { SixeskService } from './sixesk-service';
import type { SixeskMessage } from './types';
import { detectIntent } from '../plugin-routing-telemetry';
import { cleanMessageText, truncateSnippet } from './sixesk-text';

const RECENT_THREAD_LIMIT = 8;
const THREAD_SNIPPET_CHARS_DEFAULT = 280;
const HISTORY_LIMIT = 8;
const MINIMAL_THREAD_LIMIT = 2;

const isPriorityTicket = (priority: string | null | undefined): boolean => {
  const value = (priority || '').toLowerCase();
  return ['high', 'urgent', 'critical', 'p1', 'p0'].includes(value);
};

const normalizeIssueSignature = (subject: string | null | undefined): string => {
  const value = (subject || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return value
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 6)
    .join(' ');
};

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatHistoryLine = (item: {
  ticketId: string;
  subject: string | null;
  status: string;
  priority: string;
  channel: 'email' | 'whatsapp' | 'voice';
  requesterEmail: string;
  lastMessageAt: string | null;
}): string => {
  const title = item.subject?.trim() || '(no subject)';
  const time = item.lastMessageAt || 'unknown time';
  return `- [${item.channel}] ${title} | ${item.status}/${item.priority} | ${item.requesterEmail} | ${time} | ${item.ticketId}`;
};

const buildMergeHintLines = (
  ticket: { id: string; subject: string | null; requester_email: string; updated_at: string; created_at: string },
  currentChannel: 'email' | 'whatsapp' | 'voice',
  history: Array<{
    ticketId: string;
    subject: string | null;
    requesterEmail: string;
    channel: 'email' | 'whatsapp' | 'voice';
    lastMessageAt: string | null;
  }>
): string[] => {
  if (!history.length) {
    return ['- No prior tickets found; no merge hints available.'];
  }

  const candidates = history.filter((item) => item.ticketId !== ticket.id);
  if (!candidates.length) {
    return ['- Current ticket is the only known record for this customer.'];
  }

  const hints: string[] = [];
  const normalizedRequester = ticket.requester_email.toLowerCase();
  const sameIdentity = candidates.filter((item) => item.requesterEmail.toLowerCase() === normalizedRequester);
  if (sameIdentity.length) {
    hints.push(`- Same identity overlap: ${sameIdentity.length} ticket(s) share requester identity.`);
  }

  const signature = normalizeIssueSignature(ticket.subject);
  if (signature) {
    const sameIssue = candidates.filter((item) => normalizeIssueSignature(item.subject) === signature);
    if (sameIssue.length) {
      hints.push(`- Similar issue signature: ${sameIssue.length} ticket(s) appear to match subject intent.`);
    }
  }

  const anchorTime = parseTime(ticket.updated_at) ?? parseTime(ticket.created_at);
  if (anchorTime !== null) {
    const shortWindow = candidates.filter((item) => {
      const itemTime = parseTime(item.lastMessageAt);
      if (itemTime === null) return false;
      return Math.abs(anchorTime - itemTime) <= 2 * 60 * 60 * 1000;
    });
    if (shortWindow.length) {
      hints.push(`- Short-window duplicates: ${shortWindow.length} ticket(s) updated within ~2h.`);
    }
  }

  const crossChannel = candidates.filter((item) => item.channel !== currentChannel);
  if (crossChannel.length) {
    hints.push(
      `- Cross-channel context: ${crossChannel.length} ticket(s) are on a different channel; prefer customer merge over ticket merge.`
    );
  }

  return hints.length ? hints : ['- No strong duplicate signals detected in current history.'];
};

const pickMinimalRecentMessages = (messages: SixeskMessage[]): SixeskMessage[] => {
  if (!messages.length) return [];
  const lastInboundIndex = [...messages]
    .reverse()
    .findIndex((m) => m.direction === 'inbound' && cleanMessageText(m.text));
  const inboundIdx =
    lastInboundIndex >= 0 ? messages.length - 1 - lastInboundIndex : -1;

  const outboundIdx =
    inboundIdx > 0
      ? [...messages.slice(0, inboundIdx)]
          .reverse()
          .findIndex((m) => m.direction === 'outbound' && cleanMessageText(m.text))
      : -1;
  const resolvedOutboundIdx =
    outboundIdx >= 0 && inboundIdx > 0 ? inboundIdx - 1 - outboundIdx : -1;

  const picks: SixeskMessage[] = [];
  if (resolvedOutboundIdx >= 0) {
    picks.push(messages[resolvedOutboundIdx]);
  }
  if (inboundIdx >= 0) {
    if (resolvedOutboundIdx !== inboundIdx) {
      picks.push(messages[inboundIdx]);
    }
  }

  if (picks.length >= 1) return picks;
  return messages.slice(-MINIMAL_THREAD_LIMIT);
};

const findLatestInboundText = (messages: SixeskMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.direction !== 'inbound') continue;
    const cleaned = cleanMessageText(msg.text);
    if (cleaned) return cleaned;
  }
  return '';
};

/**
 * Provider that supplies ticket context from 6esk CRM into the agent's prompt.
 * Only produces output when the message has a ticketId in its metadata
 * (set by the webhook route handler).
 */
export const sixeskTicketProvider: Provider = {
  name: 'SIXESK_TICKET_CONTEXT',
  description: 'Provides current ticket context from 6esk CRM',
  position: 50,

  get: async (runtime: IAgentRuntime, message: Memory): Promise<ProviderResult> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    if (!service || !service.isConfigured) {
      return { text: '', values: {}, data: {} };
    }

    const ticketId = (message.content?.metadata as Record<string, unknown>)?.ticketId as
      | string
      | undefined;
    if (!ticketId) {
      return { text: '', values: {}, data: {} };
    }

    const context = service.getTicketContext(ticketId);
    if (!context) {
      return { text: '', values: {}, data: {} };
    }

    const { ticket, messages, summary, isPriority, callContext } = context;

    const priorityTicket = typeof isPriority === 'boolean' ? isPriority : isPriorityTicket(ticket.priority);
    const latestInboundText = findLatestInboundText(messages);
    const intentSignal = latestInboundText || ticket.subject || '';
    const intentInfo = detectIntent(intentSignal);
    const shouldMinimize = !priorityTicket && intentInfo.risk === 'low';

    const snippetLimit = Number(
      runtime.getSetting('SIXESK_THREAD_SNIPPET_CHARS') ?? THREAD_SNIPPET_CHARS_DEFAULT
    );
    const snippetChars = Number.isFinite(snippetLimit) && snippetLimit > 0
      ? Math.round(snippetLimit)
      : THREAD_SNIPPET_CHARS_DEFAULT;

    const recentMessages = priorityTicket
      ? messages
      : shouldMinimize
        ? pickMinimalRecentMessages(messages)
        : messages.slice(-RECENT_THREAD_LIMIT);
    const currentChannel = recentMessages.at(-1)?.channel ?? 'email';
    const customerHistory = (context.customerHistory || []).slice(0, shouldMinimize ? 3 : HISTORY_LIMIT);

    const ticketInfo = [
      `Subject: ${ticket.subject}`,
      `Status: ${ticket.status}`,
      `Priority: ${ticket.priority}`,
      `Requester: ${ticket.requester_email}`,
      `Created: ${ticket.created_at}`,
      ...(ticket.tags?.length ? [`Tags: ${ticket.tags.join(', ')}`] : []),
    ].join('\n');

    const threadLines = recentMessages.map((m) => {
      const direction = m.direction === 'inbound' ? 'Customer' : 'Support';
      const time = m.receivedAt || m.sentAt || 'unknown';
      const body = truncateSnippet(m.text, snippetChars) || '(no text body)';
      return `[${direction} - ${time}]\n${body}`;
    });

    const formattedThread = threadLines.join('\n---\n');
    const customerHistoryText = shouldMinimize
      ? ''
      : customerHistory.length
        ? customerHistory.map((item) => formatHistoryLine(item)).join('\n')
        : 'No related history available.';
    const mergeHints = shouldMinimize
      ? ''
      : buildMergeHintLines(ticket, currentChannel, customerHistory).join('\n');
    const channelSafetyGuidance =
      'If channels differ, prefer customer merge. Never attempt direct cross-channel ticket merge.';

    const callContextLines: string[] = [];
    if (callContext) {
      callContextLines.push(`Last call status: ${callContext.status ?? 'unknown'}`);
      if (callContext.durationSeconds !== null && callContext.durationSeconds !== undefined) {
        callContextLines.push(`Duration: ${callContext.durationSeconds}s`);
      }
      if (callContext.transcriptExcerpt) {
        callContextLines.push(`Transcript excerpt: ${callContext.transcriptExcerpt}`);
      } else if (callContext.transcriptUrl || callContext.transcriptR2Key) {
        callContextLines.push('Transcript available (not included).');
      }
      if (callContext.recordingUrl || callContext.recordingR2Key) {
        callContextLines.push('Recording available.');
      }
    }
    const callContextText = callContextLines.length
      ? addHeader('# Call Context', callContextLines.join('\n'))
      : '';

    const ticketContext =
      addHeader('# Current Ticket', ticketInfo) +
      '\n\n' +
      (!priorityTicket && summary?.text && !shouldMinimize
        ? `${addHeader('# Thread Summary', summary.text)}\n\n`
        : '') +
      addHeader(
        priorityTicket ? '# Full Thread' : shouldMinimize ? '# Recent Thread (Minimized)' : '# Recent Thread',
        formattedThread
      ) +
      (shouldMinimize ? '' : '\n\n' + addHeader('# Customer History', customerHistoryText)) +
      (shouldMinimize ? '' : '\n\n' + addHeader('# Candidate Merge Hints', mergeHints)) +
      '\n\n' +
      addHeader('# Channel Safety Guidance', channelSafetyGuidance) +
      (callContextText ? `\n\n${callContextText}` : '');

    return {
      text: ticketContext,
      values: { ticketContext },
      data: {
        ticket,
        messages: recentMessages,
        summary,
        customerHistory,
        mergeHints,
        callContext,
        intent: intentInfo.intent,
        minimized: shouldMinimize,
      },
    };
  },
};
