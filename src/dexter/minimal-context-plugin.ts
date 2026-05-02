import {
  addHeader,
  formatMessages,
  getEntityDetails,
  type IAgentRuntime,
  type Memory,
  type Provider,
  type Plugin,
} from '@elizaos/core';

const recentMessagesProvider: Provider = {
  name: 'RECENT_MESSAGES',
  description: 'Recent conversation messages for prompt context',
  position: 100,
  get: async (runtime: IAgentRuntime, message: Memory) => {
    const roomId = message.roomId;
    const MAX_TOKEN_BUDGET = 1800; // ~7.2k chars, stays within channel budgets
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const maxMessages =
      typeof runtime.getConversationLength === 'function'
        ? Math.min(runtime.getConversationLength(), 6)
        : 6;

    const [entitiesData, recentMessagesData] = await Promise.all([
      getEntityDetails({ runtime, roomId }),
      runtime.getMemories({
        tableName: 'messages',
        roomId,
        count: maxMessages,
        unique: false,
      }),
    ]);

    // Keep only the latest messages to avoid answering older questions.
    const ordered = [...recentMessagesData].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    // Trim newest-first to stay within a token budget instead of only count-based.
    let tokenTotal = 0;
    const budgetedReversed: Memory[] = [];
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const m = ordered[i];
      const text = typeof m.content?.text === 'string' ? m.content.text : JSON.stringify(m.content ?? {});
      const tokens = estimateTokens(text);
      if (tokenTotal + tokens > MAX_TOKEN_BUDGET && budgetedReversed.length > 0) {
        break;
      }
      tokenTotal += tokens;
      budgetedReversed.push(m);
      if (budgetedReversed.length >= maxMessages) {
        break;
      }
    }

    const recentSlice = budgetedReversed.reverse();

    let formatted = formatMessages({ messages: recentSlice, entities: entitiesData });

    if (!formatted && message.content?.text) {
      formatted = `User: ${message.content.text}`;
    }

    const recentMessages = addHeader('# Conversation Messages', formatted);

    const receivedMessage = message.content?.text?.trim()
      ? addHeader('# Received Message', `User: ${message.content.text}`)
      : '';
    const focusHeader = addHeader(
      '# Focus',
      'Answer ONLY the most recent user message above. Do not answer older questions unless the latest message explicitly asks to revisit them.'
    );
    const combinedText = [recentMessages, receivedMessage, focusHeader]
      .filter(Boolean)
      .join('\n\n');

    return {
      data: { recentMessages: recentSlice },
      values: { recentMessages: combinedText },
      text: combinedText,
    };
  },
};

export const minimalContextPlugin: Plugin = {
  name: 'module-dexter-minimal-context',
  description: 'Minimal providers for Dexter runtime context',
  providers: [recentMessagesProvider],
};
