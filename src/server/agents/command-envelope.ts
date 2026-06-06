import { z } from "zod";

const uuidSchema = z.string().uuid();
const nonEmptyText = z.string().trim().min(1);
const commandVersion = "2026-05-14";

export const dexterCommandNameSchema = z.enum([
  "agent.run.create",
  "agent.run.cancel",
  "agent.wait",
  "agent.tool.requested",
  "agent.tool.completed",
  "agent.approval.requested",
  "agent.run.completed"
]);

export const dexterRolloutModeSchema = z.enum([
  "dry_run",
  "draft_only",
  "hybrid_review",
  "full_auto"
]);

export const dexterProviderModeSchema = z.enum(["none", "managed", "byo"]);

export const dexterActorSchema = z.object({
  type: z.enum(["system", "user", "agent"]),
  id: z.string().trim().max(120).optional(),
  displayName: z.string().trim().max(120).optional()
}).strict();

export const dexterResourceRefSchema = z.object({
  type: nonEmptyText.max(80),
  id: uuidSchema
}).strict();

export const dexterCommandEnvelopeSchema = z.object({
  protocol: z.literal("6esk.dexter.control-plane"),
  version: z.literal(commandVersion),
  command: dexterCommandNameSchema,
  tenantId: uuidSchema,
  runId: uuidSchema,
  actor: dexterActorSchema,
  idempotencyKey: nonEmptyText.max(240),
  source: z.object({
    channel: nonEmptyText.max(80),
    triggerEventType: nonEmptyText.max(160),
    outboxEventId: uuidSchema.optional(),
    payloadSchema: z.string().trim().max(120).nullable().optional()
  }).strict(),
  resourceRefs: z.array(dexterResourceRefSchema).max(8),
  requestedScopes: z.array(nonEmptyText.max(120)).max(50),
  rolloutMode: dexterRolloutModeSchema,
  providerMode: dexterProviderModeSchema,
  laneKey: nonEmptyText.max(320),
  createdAt: z.string().datetime()
}).strict();

export type DexterCommandEnvelope = z.infer<typeof dexterCommandEnvelopeSchema>;
export type DexterRolloutMode = z.infer<typeof dexterRolloutModeSchema>;
export type DexterProviderMode = z.infer<typeof dexterProviderModeSchema>;

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequestedScopes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((scope) => readString(scope))
    .filter((scope): scope is string => Boolean(scope))
    .slice(0, 50);
}

function normalizeRolloutMode(value: unknown): DexterRolloutMode {
  const mode = readString(value);
  if (mode === "dry_run" || mode === "draft_only" || mode === "hybrid_review" || mode === "full_auto") {
    return mode;
  }
  if (mode === "auto" || mode === "limited_auto") {
    return "full_auto";
  }
  return "draft_only";
}

function normalizeProviderMode(value: unknown): DexterProviderMode {
  const mode = readString(value);
  if (mode === "none" || mode === "managed" || mode === "byo") {
    return mode;
  }
  if (mode === "managed_ai") return "managed";
  if (mode === "byo_ai" || mode === "bring_your_own") return "byo";
  return "managed";
}

function validationMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

export function parseDexterCommandEnvelope(value: unknown): DexterCommandEnvelope {
  const parsed = dexterCommandEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid Dexter command envelope: ${validationMessage(parsed.error)}`);
  }
  return parsed.data;
}

export function buildOutboxRunCreateCommand(input: {
  tenantId: string;
  integrationId: string;
  runId: string;
  outboxEventId: string;
  eventType: string;
  sourceChannel: string;
  resourceType: string | null;
  resourceId: string | null;
  idempotencyKey: string | null;
  requestedScopes: unknown;
  rolloutMode: unknown;
  providerMode: unknown;
  laneKey: string;
  payloadSchema?: string | null;
  createdAt?: Date;
}) {
  const envelope = {
    protocol: "6esk.dexter.control-plane",
    version: commandVersion,
    command: "agent.run.create",
    tenantId: input.tenantId,
    runId: input.runId,
    actor: {
      type: "agent",
      id: input.integrationId,
      displayName: "Dexter outbox integration"
    },
    idempotencyKey: input.idempotencyKey ?? `outbox:${input.outboxEventId}`,
    source: {
      channel: input.sourceChannel,
      triggerEventType: input.eventType,
      outboxEventId: input.outboxEventId,
      payloadSchema: input.payloadSchema ?? null
    },
    resourceRefs:
      input.resourceType && input.resourceId
        ? [{ type: input.resourceType, id: input.resourceId }]
        : [],
    requestedScopes: normalizeRequestedScopes(input.requestedScopes),
    rolloutMode: normalizeRolloutMode(input.rolloutMode),
    providerMode: normalizeProviderMode(input.providerMode),
    laneKey: input.laneKey,
    createdAt: (input.createdAt ?? new Date()).toISOString()
  };

  return parseDexterCommandEnvelope(envelope);
}
