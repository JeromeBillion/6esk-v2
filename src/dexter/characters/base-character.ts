import { type Character } from '@elizaos/core';
import { sharedKnowledge } from '../knowledge/shared-knowledge';

/**
 * Shared character fields used by all Dexter agents.
 * Platform-specific characters spread this and override what they need.
 */
export const baseCharacterFields: Partial<Character> = {
  username: 'dexter_6esk',
  plugins: [
    '@elizaos/plugin-sql',
    ...(process.env.GROQ_API_KEY?.trim() ? ['@elizaos/plugin-groq'] : []),
  ],
  settings: {
    // Model names are env-driven; defaults keep us running if envs are missing.
    GROQ_SMALL_MODEL: process.env.GROQ_SMALL_MODEL?.trim() || 'llama-3.1-8b-instant',
    GROQ_LARGE_MODEL: process.env.GROQ_LARGE_MODEL?.trim() || 'openai/gpt-oss-120b',
    secrets: {},
    voice: {
      model: 'en_US-hfc_female-medium',
    },
  },
  knowledge: sharedKnowledge as unknown as Character['knowledge'],
  topics: [
    'customer support',
    'CRM operations',
    'tenant privacy',
    'support tickets',
    'approved business knowledge',
    'AI safety',
    'human escalation',
  ],
  adjectives: ['precise', 'confident', 'clear', 'concise', 'helpful', 'analytical'],
};
