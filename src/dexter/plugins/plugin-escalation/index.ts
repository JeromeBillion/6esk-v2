import type { Plugin } from '@elizaos/core';
import { escalateToHumanAction } from './escalate-action';

/**
 * Lightweight escalation plugin for webchat.
 *
 * Registers the ESCALATE_TO_HUMAN action so Dexter can create a support
 * ticket on 6esk when a user insists on speaking to a human agent.
 *
 * Required env vars:
 *   SIXESK_BASE_URL       — e.g. https://app.6esk.com
 *   SIXESK_INBOUND_SECRET — the INBOUND_SHARED_SECRET configured on 6esk
 */
export const pluginEscalation: Plugin = {
    name: 'plugin-escalation',
    description: 'Webchat → 6esk ticket escalation for human handoff',
    actions: [escalateToHumanAction],
};
