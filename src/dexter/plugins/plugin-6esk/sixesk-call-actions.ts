import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type HandlerOptions,
  type IAgentRuntime,
  type Memory,
  type State,
  createUniqueUuid,
  logger,
} from '@elizaos/core';
import { SixeskService } from './sixesk-service';
import type { SixeskTicketCallOptions } from './types';
import { redactPhoneNumber } from './sixesk-text';

const ACTION_GET_CALL_OPTIONS = 'sixesk_get_ticket_call_options';
const ACTION_INITIATE_CALL = 'sixesk_initiate_ticket_call';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeActionName = (name: string): string => name.toLowerCase().replace(/_/g, '');

const readActionParams = (state: State | undefined, actionName: string): Record<string, unknown> => {
  const data = isRecord(state?.data) ? (state?.data as Record<string, unknown>) : null;
  if (!data) return {};
  const direct = isRecord(data.actionParams) ? (data.actionParams as Record<string, unknown>) : null;
  const namespacedKey = normalizeActionName(actionName);
  const namespaced = isRecord(data[namespacedKey])
    ? (data[namespacedKey] as Record<string, unknown>)
    : null;
  const merged = { ...(direct ?? {}), ...(namespaced ?? {}) };
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!key.startsWith('_')) {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

const readTicketId = (
  params: Record<string, unknown>,
  metadata: Record<string, unknown>,
  state?: State
): string | null => {
  const ticketContext = isRecord(state?.values)
    ? (state?.values as Record<string, unknown>).ticketContext
    : null;
  const ticketFromContext = isRecord(ticketContext)
    ? readString((ticketContext.ticket as Record<string, unknown> | undefined)?.id)
    : null;
  return (
    readString(params.ticketId) ||
    readString(metadata.ticketId) ||
    ticketFromContext ||
    null
  );
};

const readReason = (
  params: Record<string, unknown>,
  metadata: Record<string, unknown>,
  state?: State
): string => {
  const ticketContext = isRecord(state?.values)
    ? (state?.values as Record<string, unknown>).ticketContext
    : null;
  const subject = isRecord(ticketContext)
    ? readString((ticketContext.ticket as Record<string, unknown> | undefined)?.subject)
    : null;
  const explicit =
    readString(params.reason) ||
    readString(params.callReason) ||
    readString(metadata.callReason) ||
    readString(metadata.reason) ||
    null;
  const fallback = subject ? `Call follow-up: ${subject}` : 'Support follow-up call';
  const normalized = (explicit || fallback).replace(/\s+/g, ' ').trim().slice(0, 500);
  return normalized || 'Support follow-up call';
};

const readMetadataObject = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? (value as Record<string, unknown>) : null;

const resolveIdempotencyKey = (options: {
  runtime: IAgentRuntime;
  actionName: string;
  ticketId: string;
  candidateId: string | null;
  toPhone: string | null;
  reason: string;
  workflowId: string | null;
  explicitKey: string | null;
  handlerOptions?: HandlerOptions;
}): { idempotencyKey: string; intentKey: string } => {
  const intentSeed = `${options.ticketId}:${options.candidateId ?? options.toPhone ?? 'default'}:${options.reason}`;
  const intentKey = createUniqueUuid(options.runtime, options.workflowId || intentSeed);

  const previousResult = options.handlerOptions?.actionContext?.getPreviousResult
    ? options.handlerOptions.actionContext.getPreviousResult(options.actionName)
    : null;
  const previousKey = readString((previousResult?.data as Record<string, unknown> | undefined)?.idempotencyKey);

  let idempotencyKey =
    options.explicitKey ||
    (options.workflowId && options.workflowId.length <= 200 ? options.workflowId : null) ||
    previousKey ||
    intentKey;

  if (idempotencyKey.length > 200) {
    idempotencyKey = createUniqueUuid(options.runtime, idempotencyKey);
  }

  return { idempotencyKey, intentKey };
};

const pickCallOptions = async (
  service: SixeskService,
  ticketId: string
): Promise<SixeskTicketCallOptions> => {
  return service.fetchTicketCallOptions(ticketId);
};

export const sixeskGetTicketCallOptionsAction: Action = {
  name: ACTION_GET_CALL_OPTIONS,
  similes: ['SIXESK_GET_CALL_OPTIONS', 'CRM_GET_CALL_OPTIONS'],
  description: 'Fetches available phone candidates and consent state for a CRM ticket call.',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    return !!service?.isConfigured;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    if (!service || !service.isConfigured) {
      return {
        success: false,
        data: { actionName: ACTION_GET_CALL_OPTIONS, error: 'service_unavailable' },
        text: '6esk service not configured',
      };
    }

    const params = readActionParams(state, ACTION_GET_CALL_OPTIONS);
    const metadata = readMetadataObject(message.content?.metadata) ?? {};
    const ticketId = readTicketId(params, metadata, state);
    if (!ticketId) {
      return {
        success: false,
        data: { actionName: ACTION_GET_CALL_OPTIONS, error: 'missing_ticket_id' },
        text: 'Missing ticketId for call options',
      };
    }

    try {
      const callOptions = await pickCallOptions(service, ticketId);
      return {
        success: true,
        text: 'Fetched call options',
        values: { sixeskCallOptions: callOptions },
        data: {
          actionName: ACTION_GET_CALL_OPTIONS,
          ticketId,
          callOptions,
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error(
        { src: 'plugin:6esk', ticketId, error: messageText },
        'Failed to fetch call options'
      );
      return {
        success: false,
        text: 'Failed to fetch call options',
        data: { actionName: ACTION_GET_CALL_OPTIONS, ticketId, error: messageText },
        error: error instanceof Error ? error : new Error(messageText),
      };
    }
  },
};

export const sixeskInitiateTicketCallAction: Action = {
  name: ACTION_INITIATE_CALL,
  similes: ['SIXESK_INITIATE_CALL', 'CRM_INITIATE_CALL'],
  description:
    'Initiates a CRM-linked outbound call through 6esk with selection and consent safeguards.',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    return !!service?.isConfigured;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: HandlerOptions,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    if (!service || !service.isConfigured) {
      return {
        success: false,
        data: { actionName: ACTION_INITIATE_CALL, error: 'service_unavailable' },
        text: '6esk service not configured',
      };
    }

    const params = readActionParams(state, ACTION_INITIATE_CALL);
    const metadata = readMetadataObject(message.content?.metadata) ?? {};
    const ticketId = readTicketId(params, metadata, state);
    if (!ticketId) {
      return {
        success: false,
        data: { actionName: ACTION_INITIATE_CALL, error: 'missing_ticket_id' },
        text: 'Missing ticketId for initiate_call',
      };
    }

    const reason = readReason(params, metadata, state);
    const candidateId =
      readString(params.candidateId) ||
      readString(params.selectedCandidateId) ||
      readString(params.callCandidateId) ||
      readString(metadata.candidateId) ||
      readString(metadata.selectedCandidateId) ||
      readString(metadata.callCandidateId) ||
      null;
    const toPhone =
      readString(params.toPhone) ||
      readString(params.phone) ||
      readString(metadata.toPhone) ||
      readString(metadata.phone) ||
      null;
    const fromPhone =
      readString(params.fromPhone) || readString(metadata.fromPhone) || null;
    const explicitIdempotencyKey =
      readString(params.idempotencyKey) ||
      readString(metadata.idempotencyKey) ||
      null;
    const workflowId =
      readString(params.workflowId) ||
      readString(metadata.workflowId) ||
      null;
    const metadataOverrides = readMetadataObject(params.metadata);

    let callOptions: SixeskTicketCallOptions | null = null;
    try {
      callOptions = await pickCallOptions(service, ticketId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        text: 'Failed to fetch call options',
        data: { actionName: ACTION_INITIATE_CALL, ticketId, error: messageText },
        error: error instanceof Error ? error : new Error(messageText),
      };
    }

    if (callOptions.consent?.state === 'revoked') {
      return {
        success: false,
        text: 'Voice consent revoked',
        data: {
          actionName: ACTION_INITIATE_CALL,
          ticketId,
          status: 'blocked',
          errorCode: 'consent_required',
          retryable: false,
          consent: callOptions.consent,
        },
      };
    }

    let resolvedCandidateId = candidateId;
    let resolvedToPhone = toPhone;

    if (!resolvedCandidateId && !resolvedToPhone) {
      if (callOptions.selectionRequired) {
        return {
          success: false,
          text: 'Call selection required',
          data: {
            actionName: ACTION_INITIATE_CALL,
            ticketId,
            status: 'selection_required',
            candidates: callOptions.candidates,
            defaultCandidateId: callOptions.defaultCandidateId,
            retryable: false,
          },
          values: { sixeskCallOptions: callOptions },
        };
      }

      if (callOptions.candidates.length === 1) {
        resolvedCandidateId = callOptions.candidates[0].candidateId;
      } else if (callOptions.defaultCandidateId) {
        resolvedCandidateId = callOptions.defaultCandidateId;
      } else if (!resolvedToPhone) {
        return {
          success: false,
          text: 'No phone candidate available',
          data: {
            actionName: ACTION_INITIATE_CALL,
            ticketId,
            status: 'failed',
            errorCode: 'missing_phone',
            retryable: false,
          },
        };
      }
    }

    if (resolvedCandidateId && !callOptions.candidates.some((c) => c.candidateId === resolvedCandidateId)) {
      return {
        success: false,
        text: 'Invalid call candidate',
        data: {
          actionName: ACTION_INITIATE_CALL,
          ticketId,
          status: 'failed',
          errorCode: 'invalid_candidate',
          retryable: false,
        },
      };
    }

    const { idempotencyKey, intentKey } = resolveIdempotencyKey({
      runtime,
      actionName: ACTION_INITIATE_CALL,
      ticketId,
      candidateId: resolvedCandidateId,
      toPhone: resolvedToPhone,
      reason,
      workflowId,
      explicitKey: explicitIdempotencyKey,
      handlerOptions: options,
    });

    const metadataPayload: Record<string, unknown> = {
      ...(metadataOverrides ?? {}),
      ...(workflowId ? { workflowId } : {}),
      intentKey,
    };

    try {
      const result = await service.submitActions([
        {
          type: 'initiate_call',
          ticketId,
          candidateId: resolvedCandidateId ?? undefined,
          toPhone: resolvedToPhone ?? undefined,
          fromPhone: fromPhone ?? undefined,
          reason,
          idempotencyKey,
          metadata: Object.keys(metadataPayload).length ? metadataPayload : undefined,
        },
      ]);

      const actionResult = (result.results?.[0] ?? {}) as Record<string, unknown>;
      const status = readString(actionResult.status) || 'failed';
      const dataPayload = isRecord(actionResult.data) ? actionResult.data : null;

      const responseData = {
        actionName: ACTION_INITIATE_CALL,
        ticketId,
        status,
        idempotencyKey,
        intentKey,
        detail: readString(actionResult.detail) ?? null,
        retryable: status === 'failed',
        ...(dataPayload ?? {}),
      };

      if (status === 'ok') {
        return {
          success: true,
          text: 'Call queued',
          data: responseData,
          values: {
            sixeskCallInitiation: responseData,
          },
        };
      }

      if (status === 'selection_required') {
        return {
          success: false,
          text: 'Call selection required',
          data: { ...responseData, retryable: false },
          values: { sixeskCallOptions: callOptions },
        };
      }

      if (status === 'blocked') {
        return {
          success: false,
          text: 'Call blocked by policy',
          data: { ...responseData, retryable: false },
        };
      }

      return {
        success: false,
        text: 'Call initiation failed',
        data: responseData,
      };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const redactedTo = resolvedToPhone ? redactPhoneNumber(resolvedToPhone) : null;
      logger.error(
        { src: 'plugin:6esk', ticketId, toPhone: redactedTo, error: errMessage },
        'Failed to initiate call via 6esk'
      );
      return {
        success: false,
        text: 'Call initiation threw',
        data: {
          actionName: ACTION_INITIATE_CALL,
          ticketId,
          error: errMessage,
          idempotencyKey,
          intentKey,
        },
        error: error instanceof Error ? error : new Error(errMessage),
      };
    }
  },
};
