/**
 * Dexter — Native AI orchestration module for 6esk v2.
 *
 * Forked from Dexter (ElizaOS module-dexter). In v1, Dexter was an external
 * agent communicating with 6esk over HTTP webhooks. In v2, Dexter is a
 * first-party module that lives inside the 6esk codebase.
 *
 * Channel agents (Twitter, CRM, WhatsApp) are opt-in via env toggles.
 * Webchat agent is always active when the Dexter module is enabled.
 */

import { stringToUuid, type Character, type Project, type ProjectAgent } from '@elizaos/core';
import { webchatCharacter } from './characters/webchat-character';
import { twitterCharacter } from './characters/twitter-character';
import { crmCharacter } from './characters/crm-character';
import { whatsappCharacter } from './characters/whatsapp-character';
import { minimalContextPlugin } from './minimal-context-plugin';
import { plugin6esk } from './plugins/plugin-6esk';
import { pluginWhatsApp } from './plugins/plugin-whatsapp';
import { routingTelemetryPlugin } from './plugins/plugin-routing-telemetry';
import { pluginEscalation } from './plugins/plugin-escalation';
import { runDexterStartupGates } from './startup-gates';

// ---------------------------------------------------------------------------
// Env normalization
// ---------------------------------------------------------------------------

const normalizeLegacyTwitterEnv = (): void => {
  if (!process.env.TWITTER_API_SECRET_KEY?.trim() && process.env.TWITTER_API_SECRET?.trim()) {
    process.env.TWITTER_API_SECRET_KEY = process.env.TWITTER_API_SECRET;
  }
  if (!process.env.TWITTER_ENABLE_POST?.trim() && process.env.TWITTER_ENABLE_POST_GENERATION?.trim()) {
    process.env.TWITTER_ENABLE_POST = process.env.TWITTER_ENABLE_POST_GENERATION;
  }
  if (!process.env.TWITTER_POST_INTERVAL_MIN?.trim() && process.env.POST_INTERVAL_MIN?.trim()) {
    process.env.TWITTER_POST_INTERVAL_MIN = process.env.POST_INTERVAL_MIN;
  }
  if (!process.env.TWITTER_POST_INTERVAL_MAX?.trim() && process.env.POST_INTERVAL_MAX?.trim()) {
    process.env.TWITTER_POST_INTERVAL_MAX = process.env.POST_INTERVAL_MAX;
  }
};

normalizeLegacyTwitterEnv();
runDexterStartupGates();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isExplicitlyEnabled = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

/**
 * Ensure each channel agent has a stable unique runtime ID.
 * Webchat keeps the historical seed based on name ("Dexter") for compatibility.
 */
const withStableAgentId = (character: Character, seed: string): Character => ({
  ...character,
  id: character.id ?? stringToUuid(seed),
});

// ---------------------------------------------------------------------------
// Agent assembly
// ---------------------------------------------------------------------------

// Escalation bridge (webchat → 6esk ticket escalation)
const isEscalationBridgeEnabled = isExplicitlyEnabled(process.env.DEXTER_ENABLE_ESCALATION_BRIDGE);
const hasEscalationCredentials = !!(
  process.env.SIXESK_BASE_URL?.trim() && process.env.SIXESK_INBOUND_SECRET?.trim()
);
const webchatPlugins = [minimalContextPlugin, routingTelemetryPlugin];
if (isEscalationBridgeEnabled && hasEscalationCredentials) {
  webchatPlugins.push(pluginEscalation);
}

// Webchat Dexter — always active
const agents: ProjectAgent[] = [
  {
    character: withStableAgentId(webchatCharacter, webchatCharacter.name || 'Dexter'),
    plugins: webchatPlugins,
  },
];

// Twitter Dexter — enabled when credentials exist unless explicitly disabled
const twitterAuthMode = process.env.TWITTER_AUTH_MODE?.trim().toLowerCase() || 'env';
const hasTwitterEnvCredentials = !!(
  process.env.TWITTER_API_KEY?.trim() &&
  process.env.TWITTER_API_SECRET_KEY?.trim() &&
  process.env.TWITTER_ACCESS_TOKEN?.trim() &&
  process.env.TWITTER_ACCESS_TOKEN_SECRET?.trim()
);
const hasTwitterOAuthCredentials = !!(
  process.env.TWITTER_CLIENT_ID?.trim() &&
  process.env.TWITTER_REDIRECT_URI?.trim()
);
const hasTwitterCredentials =
  twitterAuthMode === 'oauth' ? hasTwitterOAuthCredentials : hasTwitterEnvCredentials;
const twitterEnableSetting = process.env.DEXTER_ENABLE_TWITTER_AGENT?.trim();
const isTwitterEnabled = twitterEnableSetting
  ? isExplicitlyEnabled(twitterEnableSetting)
  : hasTwitterCredentials;

if (isTwitterEnabled && !hasTwitterCredentials) {
  const missingKeys =
    twitterAuthMode === 'oauth'
      ? ['TWITTER_CLIENT_ID', 'TWITTER_REDIRECT_URI'].filter((key) => !process.env[key]?.trim())
      : ['TWITTER_API_KEY', 'TWITTER_API_SECRET_KEY|TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN_SECRET']
          .filter((key) => {
            if (key.includes('|')) {
              const [a, b] = key.split('|');
              return !process.env[a]?.trim() && !process.env[b]?.trim();
            }
            return !process.env[key]?.trim();
          });

  console.warn(
    `[Dexter] Twitter agent disabled: missing credentials for auth mode "${twitterAuthMode}": ${missingKeys.join(', ')}`
  );
}

if (isTwitterEnabled && hasTwitterCredentials) {
  agents.push({
    character: withStableAgentId(twitterCharacter, 'Dexter::twitter'),
    plugins: [minimalContextPlugin, routingTelemetryPlugin],
  });
}

// CRM Dexter — only if 6esk credentials are configured
const isCrmEnabled = isExplicitlyEnabled(process.env.DEXTER_ENABLE_CRM_AGENT);
const hasSixeskCredentials = !!(
  process.env.SIXESK_BASE_URL?.trim() &&
  process.env.SIXESK_AGENT_KEY?.trim() &&
  process.env.SIXESK_SHARED_SECRET?.trim()
);

if (isCrmEnabled && hasSixeskCredentials) {
  agents.push({
    character: withStableAgentId(crmCharacter, 'Dexter::crm'),
    plugins: [minimalContextPlugin, routingTelemetryPlugin, plugin6esk],
  });
}

// WhatsApp Dexter — only if WhatsApp credentials are configured
const isWhatsAppEnabled = isExplicitlyEnabled(process.env.DEXTER_ENABLE_WHATSAPP_AGENT);
const hasWhatsAppCredentials = !!(
  process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
  process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
  process.env.WHATSAPP_VERIFY_TOKEN?.trim() &&
  process.env.WHATSAPP_APP_SECRET?.trim()
);

if (isWhatsAppEnabled && hasWhatsAppCredentials) {
  agents.push({
    character: withStableAgentId(whatsappCharacter, 'Dexter::whatsapp'),
    plugins: [minimalContextPlugin, routingTelemetryPlugin, pluginWhatsApp],
  });
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

const project: Project = { agents };

// Backward compatibility
export { webchatCharacter as character } from './characters/webchat-character';
export default project;
