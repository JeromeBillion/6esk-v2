import { ModelType, type Plugin, type Route } from '@elizaos/core';
import { getKnowledgeForIntent } from '../knowledge/shared-knowledge';
import { RunStateController, buildRunStateConfigFromEnv } from '../reliability/run-state';
import { LoopBreaker, buildLoopBreakerConfigFromEnv } from '../reliability/loop-breaker';
import {
    withRouteScope,
    assertAllRoutesScoped,
    getRouteScope,
    resolveRouteScopeAuthConfig,
} from '../security/route-scope';
import {
    buildTrustedTelemetryConfigFromEnv,
    extractTrustedTelemetryCandidate,
    validateTrustedTelemetryCandidate,
    type TrustedTelemetryConfig,
} from '../security/trusted-upstream-telemetry';

/* ── Types ── */

type IntentInfo = { intent: string; risk: 'low' | 'high' };

type IntentRoute = {
    intent: string;
    keywords: string[];
    risk: 'low' | 'high';
    model: typeof ModelType.TEXT_SMALL | typeof ModelType.TEXT_LARGE;
    cacheable: boolean;
    /** Knowledge section keys fed to getKnowledgeForIntent */
    knowledgeSections: string[];
};

/* ── Intent routing table (P1.1) ── */

const INTENT_ROUTES: IntentRoute[] = [
    { intent: 'faq', keywords: ['what is 6ex', 'faq', 'how does 6ex work'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['platform', 'faq'] },
    { intent: 'status', keywords: ['status', 'down', 'offline', 'not working', 'outage'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['platform'] },
    { intent: 'onboarding', keywords: ['sign up', 'create account', 'onboard', 'get started', 'new user'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['platform', 'kyc', 'login', 'account'] },
    { intent: 'login', keywords: ['login', 'log in', 'otp', 'one time code', 'sign in', 'cant login', "can't login"], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['login', 'account'] },
    { intent: 'trade', keywords: ['trade', 'buy', 'sell', 'early exit', 'market price', 'how to trade', 'place a trade'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: false, knowledgeSections: ['platform', 'trading', 'earlyExit', 'markets'] },
    { intent: 'wallet', keywords: ['wallet', 'balance', 'deposit', 'withdraw', 'withdrawal'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['wallet'] },
    { intent: 'portfolio', keywords: ['portfolio', 'positions', 'my positions', 'active positions', 'resolved', 'p&l'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: false, knowledgeSections: ['portfolio', 'earlyExit'] },
    { intent: 'leaderboard', keywords: ['leaderboard', 'ranking', 'rankings', 'league table', 'top traders'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['leaderboard'] },
    { intent: 'rewards', keywords: ['rewards', 'referral', 'refer a friend', 'invite'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['rewards'] },
    { intent: 'social', keywords: ['comment', 'comments', 'react', 'reply', 'report comment'], risk: 'low', model: ModelType.TEXT_SMALL, cacheable: true, knowledgeSections: ['social'] },
    { intent: 'kyc', keywords: ['kyc', 'verify', 'verification', 'id check', 'proof of address', 'identity'], risk: 'high', model: ModelType.TEXT_LARGE, cacheable: true, knowledgeSections: ['kyc', 'account'] },
    { intent: 'billing', keywords: ['billing', 'payment', 'charge', 'chargeback', 'dispute', 'refund'], risk: 'high', model: ModelType.TEXT_LARGE, cacheable: false, knowledgeSections: ['wallet', 'trading'] },
    { intent: 'compliance', keywords: ['compliance', 'legal', 'policy', 'terms', 'privacy', 'escalate', 'escalation', 'fraud'], risk: 'high', model: ModelType.TEXT_LARGE, cacheable: false, knowledgeSections: ['platform', 'kyc'] },
    { intent: 'account_specific', keywords: ['my account', 'my balance', 'ticket', 'case', 'id number'], risk: 'high', model: ModelType.TEXT_LARGE, cacheable: false, knowledgeSections: ['account', 'wallet', 'portfolio', 'kyc'] },
];

/* ── Helpers ── */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_CACHE_MAX_ENTRIES = 300;
const MAX_CACHE_MAX_ENTRIES = 5000;
const RECOMMENDED_SMALL_MODEL = 'llama-3.1-8b-instant';
const RECOMMENDED_LARGE_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_CRM_LOW_RISK_MAX_TOKENS = 360;
const MIN_CRM_LOW_RISK_MAX_TOKENS = 200;
const MAX_CRM_LOW_RISK_MAX_TOKENS = 520;
const RUN_STATE_RUNTIME_KEY = '__DexterRunStateController';
const LOOP_BREAKER_RUNTIME_KEY = '__DexterLoopBreakerController';
const ROUTING_CACHE_RUNTIME_KEY = '__DexterRoutingCacheStore';
const TRUSTED_TELEMETRY_RUNTIME_KEY = '__DexterTrustedTelemetryConfig';
type RoutingCacheEntry = {
    value: string;
    expiresAt: number;
    createdAt: number;
    lastAccessedAt: number;
    model: string;
    routeReason: string;
};

const accountSpecificTerms = [
    'my account',
    'my balance',
    'ticket',
    'case',
    'id number',
    'id #',
    'statement',
];

function toCsv(rows: Array<Record<string, unknown>>): string {
    if (!rows.length) return '';
    const headers = Array.from(
        rows.reduce((set, row) => {
            Object.keys(row).forEach((k) => set.add(k));
            return set;
        }, new Set<string>())
    );
    const escape = (val: unknown) => {
        if (val === null || val === undefined) return '';
        const s = String(val).replace(/"/g, '""');
        return `"${s}"`;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => escape((row as any)[h])).join(','));
    }
    return lines.join('\n');
}

function estimateTokens(text: string | undefined | null): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4); // rough heuristic
}

function normalizeKey(text: string): string {
    return text.trim().toLowerCase();
}

function parseIntegerEnv(value: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.round(parsed), min), max);
}

function resolveModelSettings(runtime: any) {
    const settings = (runtime.character?.settings || {}) as Record<string, unknown>;
    const fromSettingsSmall =
        typeof settings.GROQ_SMALL_MODEL === 'string' ? settings.GROQ_SMALL_MODEL.trim() : '';
    const fromSettingsLarge =
        typeof settings.GROQ_LARGE_MODEL === 'string' ? settings.GROQ_LARGE_MODEL.trim() : '';

    const envSmall = process.env.GROQ_SMALL_MODEL?.trim() || '';
    const envLarge = process.env.GROQ_LARGE_MODEL?.trim() || '';

    const smallModel = fromSettingsSmall || envSmall || RECOMMENDED_SMALL_MODEL;
    const largeModel = fromSettingsLarge || envLarge || RECOMMENDED_LARGE_MODEL;

    return { smallModel, largeModel };
}

function applyTokenCap(
    params: Record<string, unknown> | null | undefined,
    cap: number | null
): Record<string, unknown> | null | undefined {
    if (!cap || !params || typeof params !== 'object' || Array.isArray(params)) {
        return params;
    }
    const next = { ...params };
    const currentMax = typeof next.maxTokens === 'number' ? next.maxTokens : undefined;
    next.maxTokens = currentMax ? Math.min(currentMax, cap) : cap;
    return next;
}

function resolveCrmLowRiskCap() {
    const raw = process.env.CRM_LOW_RISK_MAX_TOKENS?.trim();
    if (!raw) {
        return DEFAULT_CRM_LOW_RISK_MAX_TOKENS;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_CRM_LOW_RISK_MAX_TOKENS;
    }
    return Math.min(Math.max(Math.round(parsed), MIN_CRM_LOW_RISK_MAX_TOKENS), MAX_CRM_LOW_RISK_MAX_TOKENS);
}

function logRoutingConfiguration(runtime: any, config: {
    smallModel: string;
    largeModel: string;
    degradeForceSmall: boolean;
    degradeMaxTokens: number | null;
    cacheMaxEntries: number;
    crmLowRiskMaxTokens: number;
}) {
    const {
        smallModel,
        largeModel,
        degradeForceSmall,
        degradeMaxTokens,
        cacheMaxEntries,
        crmLowRiskMaxTokens,
    } = config;

    runtime.logger.info(
        {
            src: 'routing',
            small_model: smallModel,
            large_model: largeModel,
            recommended_small_model: RECOMMENDED_SMALL_MODEL,
            recommended_large_model: RECOMMENDED_LARGE_MODEL,
            degrade_force_small: degradeForceSmall,
            degrade_max_tokens: degradeMaxTokens ?? undefined,
            cache_ttl_ms: CACHE_TTL_MS,
            cache_max_entries: cacheMaxEntries,
            crm_low_risk_max_tokens: crmLowRiskMaxTokens,
        },
        'routing_config'
    );

    if (smallModel === largeModel) {
        runtime.logger.warn(
            {
                src: 'routing',
                small_model: smallModel,
                large_model: largeModel,
            },
            'routing_config_warning_same_models'
        );
    }

    if (smallModel !== RECOMMENDED_SMALL_MODEL || largeModel !== RECOMMENDED_LARGE_MODEL) {
        runtime.logger.warn(
            {
                src: 'routing',
                small_model: smallModel,
                large_model: largeModel,
                recommended_small_model: RECOMMENDED_SMALL_MODEL,
                recommended_large_model: RECOMMENDED_LARGE_MODEL,
            },
            'routing_config_warning_non_recommended_models'
        );
    }

    if (degradeMaxTokens !== null && degradeMaxTokens < 128) {
        runtime.logger.warn(
            {
                src: 'routing',
                degrade_max_tokens: degradeMaxTokens,
            },
            'routing_config_warning_low_degrade_max_tokens'
        );
    }
}

function pruneExpiredCacheEntries(
    cacheStore: Map<string, RoutingCacheEntry>,
    now: number
) {
    for (const [key, entry] of cacheStore.entries()) {
        if (entry.expiresAt <= now) {
            cacheStore.delete(key);
        }
    }
}

function pruneOverflowCacheEntries(
    cacheStore: Map<string, RoutingCacheEntry>,
    maxEntries: number
) {
    if (cacheStore.size <= maxEntries) {
        return;
    }

    const entries = Array.from(cacheStore.entries()).sort(
        (a, b) =>
            a[1].lastAccessedAt - b[1].lastAccessedAt ||
            a[1].createdAt - b[1].createdAt
    );

    for (const [key] of entries) {
        if (cacheStore.size <= maxEntries) {
            break;
        }
        cacheStore.delete(key);
    }
}

function maintainCache(
    cacheStore: Map<string, RoutingCacheEntry>,
    now: number,
    maxEntries: number
) {
    pruneExpiredCacheEntries(cacheStore, now);
    pruneOverflowCacheEntries(cacheStore, maxEntries);
}

async function persistRoutingLog(runtime: any, type: string, body: Record<string, unknown>) {
    if (typeof runtime.log !== 'function') {
        return;
    }

    try {
        await runtime.log({
            entityId: runtime.agentId,
            roomId: runtime.agentId,
            type,
            body,
        });
    } catch (persistErr) {
        runtime.logger.warn(
            {
                src: 'routing',
                log_type: type,
                persist_error:
                    persistErr instanceof Error ? persistErr.message : String(persistErr),
            },
            'routing_log_persist_failed'
        );
    }
}

function getPromptText(params: Record<string, unknown> | null | undefined): string {
    if (!params || typeof params !== 'object') return '';
    if ('prompt' in params && typeof params.prompt === 'string') return params.prompt;
    if ('input' in params && typeof params.input === 'string') return params.input;
    if ('messages' in params && Array.isArray((params as any).messages)) {
        try {
            return JSON.stringify((params as any).messages);
        } catch {
            return '';
        }
    }
    return '';
}

function normalizeIntentLine(line: string): string {
    return line
        .replace(/^\s*(?:User|Customer|Client|Guest|Member|user\d+)\s*:\s*/i, '')
        .trim();
}

function extractConversationSection(promptText: string): string {
    if (!promptText) return '';
    const marker = '# CONVERSATION';
    const idx = promptText.lastIndexOf(marker);
    if (idx < 0) return promptText;

    const after = promptText.slice(idx + marker.length);
    const stopMarkers = [
        '# RESPONSE RULES',
        '# RULES',
        '# OUTPUT FORMAT',
        '# HUMAN ESCALATION',
        '# CRM RESPONSE RULES',
        '# WHATSAPP RULES',
        '# STAMP',
        '# FORMATS',
        '# RITUALS',
    ];

    const upper = after.toUpperCase();
    let end = after.length;
    for (const stop of stopMarkers) {
        const pos = upper.indexOf(stop);
        if (pos >= 0 && pos < end) {
            end = pos;
        }
    }

    return after.slice(0, end);
}

function extractLatestUserLine(text: string): string {
    if (!text) return '';

    const receivedMatch = text.match(/#\s*Received Message\s*[\r\n]+([^\r\n]+)/i);
    if (receivedMatch?.[1]) {
        const normalized = normalizeIntentLine(receivedMatch[1]);
        if (normalized) return normalized;
    }

    const userLineRegex = /^\s*(?:User|Customer|Client|Guest|Member|user\d+)\s*:\s*(.+)$/gim;
    let latest = '';
    for (const match of text.matchAll(userLineRegex)) {
        latest = normalizeIntentLine(match[0] ?? '');
    }
    if (latest) return latest;

    return '';
}

function extractFromMessageArray(params: Record<string, unknown>): string {
    if (!('messages' in params) || !Array.isArray((params as any).messages)) {
        return '';
    }

    const messages = (params as any).messages as Array<Record<string, unknown>>;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const entry = messages[i] ?? {};
        const role = String(entry.role ?? entry.sender ?? entry.name ?? '').toLowerCase();
        const isUserRole =
            role.includes('user') || role === 'human' || role === 'customer' || role === 'client';

        const rawContent =
            typeof entry.content === 'string'
                ? entry.content
                : typeof (entry.content as any)?.text === 'string'
                    ? (entry.content as any).text
                    : typeof entry.text === 'string'
                        ? (entry.text as string)
                        : '';

        if (isUserRole && rawContent.trim()) {
            return rawContent.trim();
        }
    }

    const fallback = messages[messages.length - 1];
    const fallbackContent =
        typeof fallback?.content === 'string'
            ? fallback.content
            : typeof (fallback?.content as any)?.text === 'string'
                ? (fallback.content as any).text
                : typeof fallback?.text === 'string'
                    ? fallback.text
                    : '';

    return fallbackContent.trim();
}

/**
 * Build intent signal text from the latest user utterance rather than full prompt body.
 * This prevents KB keywords from biasing intent detection toward FAQ.
 */
export function getIntentSignalText(params: Record<string, unknown> | null | undefined): string {
    if (!params || typeof params !== 'object') return '';

    if ('input' in params && typeof params.input === 'string' && params.input.trim()) {
        return params.input.trim();
    }

    if ('message' in params && typeof (params as any).message === 'string' && (params as any).message.trim()) {
        return (params as any).message.trim();
    }

    const fromMessages = extractFromMessageArray(params);
    if (fromMessages) {
        return fromMessages;
    }

    const promptText = getPromptText(params);
    if (!promptText) {
        return '';
    }

    const conversation = extractConversationSection(promptText);
    const latestUserLine = extractLatestUserLine(conversation);
    if (latestUserLine) {
        return latestUserLine;
    }

    return promptText;
}

/** Detect intent from prompt text using the routing table (P1.1). */
export function detectIntent(text: string): IntentInfo {
    const lowered = text.toLowerCase();
    for (const route of INTENT_ROUTES) {
        if (route.keywords.some((k) => lowered.includes(k))) {
            return { intent: route.intent, risk: route.risk };
        }
    }
    return { intent: 'unknown', risk: 'low' };
}

/** Get the IntentRoute config for a detected intent. */
function getIntentRoute(intent: string): IntentRoute | undefined {
    return INTENT_ROUTES.find((r) => r.intent === intent);
}

/** Route model selection based on intent (replaces old chooseRoute + detectIntent). */
function routeForIntent(intentInfo: IntentInfo): { modelType: typeof ModelType.TEXT_SMALL | typeof ModelType.TEXT_LARGE; reason: string } {
    const route = getIntentRoute(intentInfo.intent);
    if (route) {
        return { modelType: route.model, reason: `intent_${route.intent}` };
    }
    // Unknown intent → small model by default
    return { modelType: ModelType.TEXT_SMALL, reason: 'default_small' };
}

/** Check if prompt is cacheable based on intent route config. */
function isCacheable(text: string, intentInfo: IntentInfo): boolean {
    if (!text.trim()) return false;
    const lowered = text.toLowerCase();
    // Never cache account-specific queries
    if (accountSpecificTerms.some((t) => lowered.includes(t))) return false;
    const route = getIntentRoute(intentInfo.intent);
    return route?.cacheable ?? false;
}

/**
 * Replace the full knowledge block in the prompt with intent-segmented
 * knowledge to reduce token usage (P1.3).
 */
function segmentPromptKnowledge(promptText: string, intent: string): string {
    const KB_MARKER = '# KNOWLEDGE BASE';
    const kbStart = promptText.indexOf(KB_MARKER);
    if (kbStart < 0) return promptText; // no knowledge block

    // Find the next top-level section header (# not ##) after the KB header
    const afterMarker = kbStart + KB_MARKER.length;
    let kbEnd = promptText.length;
    // Look for next "\n# " that is NOT "\n## "
    let searchFrom = afterMarker;
    while (searchFrom < promptText.length) {
        const nextHash = promptText.indexOf('\n# ', searchFrom);
        if (nextHash < 0) break;
        // Check it's not "## " (subsection inside KB)
        if (promptText[nextHash + 3] !== '#') {
            kbEnd = nextHash;
            break;
        }
        searchFrom = nextHash + 3;
    }

    const segmented = getKnowledgeForIntent(intent);
    return promptText.substring(0, kbStart) + segmented + promptText.substring(kbEnd);
}

/** Apply knowledge segmentation to params, modifying the prompt in-place. */
function applyKnowledgeSegmentation(params: Record<string, unknown> | null | undefined, intent: string): Record<string, unknown> | null | undefined {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
    if ('prompt' in params && typeof params.prompt === 'string') {
        const segmented = segmentPromptKnowledge(params.prompt, intent);
        if (segmented !== params.prompt) {
            return { ...params, prompt: segmented };
        }
    }
    return params;
}

async function aggregateLogs(runtime: any, limit = 200) {
    if (typeof runtime.getLogs !== 'function') return null;
    const logs = await runtime.getLogs({
        type: 'routing:model_used',
        limit,
    });
    const agg: Record<string, any> = {
        total: 0,
        by_model: {},
        by_route_reason: {},
        cache_hits: 0,
        cache_misses: 0,
        cache_skipped: 0,
        avg_latency_ms: 0,
    };

    let latencySum = 0;
    for (const log of logs || []) {
        const body = (log as any).body || {};
        agg.total += 1;
        const m = body.model || 'unknown';
        agg.by_model[m] = (agg.by_model[m] || 0) + 1;
        const rr = body.route_reason || 'unknown';
        agg.by_route_reason[rr] = (agg.by_route_reason[rr] || 0) + 1;
        latencySum += typeof body.latency_ms === 'number' ? body.latency_ms : 0;
        if (body.cache === 'hit') agg.cache_hits += 1;
        else if (body.cache === 'miss') agg.cache_misses += 1;
        else agg.cache_skipped += 1;
    }
    agg.avg_latency_ms = agg.total ? latencySum / agg.total : 0;
    return agg;
}

type RouteScopeManifestRow = {
    method: string;
    path: string;
    name?: string;
    scope: string;
    auth_required: boolean;
    webhook: boolean;
    namespaced: boolean;
};

function isWebhookRoute(path: string): boolean {
    return path.startsWith('/hooks/') || path.startsWith('/webhooks/');
}

function isNamespacedRoute(path: string): boolean {
    return path.startsWith('/plugin-');
}

function buildRouteScopeManifest(runtime: any): {
    generated_at: string;
    auth_enabled: boolean;
    token_sources: { read: string[]; execute: string[] };
    totals: { routes: number; scoped: number; unscoped: number; by_scope: Record<string, number> };
    routes: RouteScopeManifestRow[];
} {
    const authConfig = resolveRouteScopeAuthConfig();
    const routes = Array.isArray(runtime.routes) ? (runtime.routes as Route[]) : [];

    const rows: RouteScopeManifestRow[] = routes.map((route) => {
        const scope = getRouteScope(route) ?? 'unscoped';
        const authRequired = authConfig.enabled && scope !== 'public' && scope !== 'unscoped';
        return {
            method: route.type,
            path: route.path,
            name: route.name,
            scope,
            auth_required: authRequired,
            webhook: isWebhookRoute(route.path),
            namespaced: isNamespacedRoute(route.path),
        };
    });

    const byScope = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.scope] = (acc[row.scope] || 0) + 1;
        return acc;
    }, {});
    const scopedCount = rows.filter((row) => row.scope !== 'unscoped').length;

    return {
        generated_at: new Date().toISOString(),
        auth_enabled: authConfig.enabled,
        token_sources: {
            read: ['DEXTER_ROUTE_READ_TOKEN', 'DEXTER_ROUTE_EXECUTE_TOKEN', 'ELIZA_SERVER_AUTH_TOKEN'],
            execute: ['DEXTER_ROUTE_EXECUTE_TOKEN', 'ELIZA_SERVER_AUTH_TOKEN'],
        },
        totals: {
            routes: rows.length,
            scoped: scopedCount,
            unscoped: rows.length - scopedCount,
            by_scope: byScope,
        },
        routes: rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    };
}

function routeScopeManifestToCsv(manifest: ReturnType<typeof buildRouteScopeManifest>): string {
    const rows = manifest.routes.map((route) => ({
        method: route.method,
        path: route.path,
        name: route.name || '',
        scope: route.scope,
        auth_required: route.auth_required,
        webhook: route.webhook,
        namespaced: route.namespaced,
    }));
    return toCsv(rows);
}

function resolveRiskForIntent(intent: string): 'low' | 'high' {
    const route = INTENT_ROUTES.find((entry) => entry.intent === intent);
    return route?.risk ?? 'low';
}

export const routingTelemetryPlugin: Plugin = {
    name: 'routing-telemetry',
    description: 'Route to small/large with simple heuristics and log usage metrics',
    priority: 90,
    routes: [
        withRouteScope({
            type: 'GET',
            path: '/routing-reliability',
            name: 'routing-reliability',
            handler: async (_req, res, runtime) => {
                const runState = (runtime as any)[RUN_STATE_RUNTIME_KEY] as RunStateController | undefined;
                const loopBreaker = (runtime as any)[LOOP_BREAKER_RUNTIME_KEY] as LoopBreaker | undefined;
                const trustedTelemetry = (runtime as any)[TRUSTED_TELEMETRY_RUNTIME_KEY] as TrustedTelemetryConfig | undefined;
                if (!runState || !loopBreaker || !trustedTelemetry) {
                    res.status(503).json({ error: 'reliability controllers not available' });
                    return;
                }
                res.status(200).json({
                    data: {
                        runState: runState.getSnapshot(),
                        runStateConfig: runState.getConfig(),
                        loopBreakerConfig: loopBreaker.getConfig(),
                        trustedTelemetryConfig: trustedTelemetry,
                    },
                });
            },
        }, 'read'),
        withRouteScope({
            type: 'GET',
            path: '/route-scope-manifest',
            name: 'route-scope-manifest',
            handler: async (_req, res, runtime) => {
                res.status(200).json({
                    data: buildRouteScopeManifest(runtime),
                });
            },
        }, 'read'),
        withRouteScope({
            type: 'GET',
            path: '/route-scope-manifest.csv',
            name: 'route-scope-manifest-csv',
            handler: async (_req, res, runtime) => {
                const manifest = buildRouteScopeManifest(runtime);
                const csv = routeScopeManifestToCsv(manifest);
                if (typeof res.setHeader === 'function') {
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                }
                res.status(200).send(csv);
            },
        }, 'read'),
        withRouteScope({
            type: 'GET',
            path: '/routing-metrics',
            name: 'routing-metrics',
            handler: async (_req, res, runtime) => {
                try {
                    const data = await aggregateLogs(runtime, 200);
                    if (!data) {
                        res.status(503).json({ error: 'logging not available' });
                        return;
                    }
                    res.status(200).json({ data });
                } catch (err) {
                    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
                }
            },
        }, 'read'),
        withRouteScope({
            type: 'GET',
            path: '/routing-logs',
            name: 'routing-logs',
            handler: async (req, res, runtime) => {
                const limit = Number((req.query?.limit as string) || 200) || 200;
                const includeErrors = (req.query?.errors as string)?.toLowerCase() === 'true';
                if (typeof runtime.getLogs !== 'function') {
                    res.status(503).json({ error: 'logging not available' });
                    return;
                }
                const types = includeErrors
                    ? ['routing:model_used', 'routing:model_used_error']
                    : ['routing:model_used'];
                const rows: any[] = [];
                for (const type of types) {
                    const logs = await runtime.getLogs({ type, limit });
                    for (const log of logs || []) {
                        const body = (log as any).body || {};
                        rows.push({
                            type,
                            timestamp: (log as any).createdAt || Date.now(),
                            agent: body.agent,
                            model: body.model,
                            route_reason: body.route_reason,
                            intent: body.intent,
                            intent_risk: body.intent_risk,
                            cache: body.cache,
                            prompt_tokens: body.prompt_tokens,
                            completion_tokens: body.completion_tokens,
                            total_tokens: body.total_tokens,
                            latency_ms: body.latency_ms,
                            degrade_force_small: body.degrade_force_small,
                            degrade_max_tokens: body.degrade_max_tokens,
                            crm_low_risk_max_tokens: body.crm_low_risk_max_tokens,
                            error_type: body.error_type,
                            trusted_telemetry_source: body.trusted_telemetry_source,
                            trusted_telemetry_reason: body.trusted_telemetry_reason,
                        });
                    }
                }
                res.status(200).json({ data: rows });
            },
        }, 'read'),
        withRouteScope({
            type: 'GET',
            path: '/routing-logs.csv',
            name: 'routing-logs-csv',
            handler: async (req, res, runtime) => {
                const limit = Number((req.query?.limit as string) || 200) || 200;
                const includeErrors = (req.query?.errors as string)?.toLowerCase() === 'true';
                if (typeof runtime.getLogs !== 'function') {
                    res.status(503).json({ error: 'logging not available' });
                    return;
                }
                const types = includeErrors
                    ? ['routing:model_used', 'routing:model_used_error']
                    : ['routing:model_used'];
                const rows: any[] = [];
                for (const type of types) {
                    const logs = await runtime.getLogs({ type, limit });
                    for (const log of logs || []) {
                        const body = (log as any).body || {};
                        rows.push({
                            type,
                            timestamp: (log as any).createdAt || Date.now(),
                            agent: body.agent,
                            model: body.model,
                            route_reason: body.route_reason,
                            intent: body.intent,
                            intent_risk: body.intent_risk,
                            cache: body.cache,
                            prompt_tokens: body.prompt_tokens,
                            completion_tokens: body.completion_tokens,
                            total_tokens: body.total_tokens,
                            latency_ms: body.latency_ms,
                            degrade_force_small: body.degrade_force_small,
                            degrade_max_tokens: body.degrade_max_tokens,
                            crm_low_risk_max_tokens: body.crm_low_risk_max_tokens,
                            error_type: body.error_type,
                            trusted_telemetry_source: body.trusted_telemetry_source,
                            trusted_telemetry_reason: body.trusted_telemetry_reason,
                        });
                    }
                }
                const csv = toCsv(rows);
                res.status(200).send(csv);
            },
        }, 'read'),
        withRouteScope({
            type: 'POST',
            path: '/routing-cache/clear',
            name: 'routing-cache-clear',
            handler: async (_req, res, runtime) => {
                const cacheStore = (runtime as any)[ROUTING_CACHE_RUNTIME_KEY] as Map<string, RoutingCacheEntry> | undefined;
                if (!cacheStore) {
                    res.status(503).json({ error: 'routing cache store not available' });
                    return;
                }
                const entriesCleared = cacheStore.size;
                cacheStore.clear();
                res.status(200).json({
                    success: true,
                    entriesCleared,
                });
            },
        }, 'execute'),
    ] as Route[],
    init: async (_config, runtime) => {
        assertAllRoutesScoped(routingTelemetryPlugin.routes || [], { allowPublic: false });
        const originalUseModel = runtime.useModel.bind(runtime);
        // Cache must be runtime-scoped to prevent cross-channel contamination
        // when webchat/crm/whatsapp/twitter agents run in the same process.
        const cacheStore = new Map<string, RoutingCacheEntry>();
        const runState = new RunStateController(buildRunStateConfigFromEnv());
        const loopBreaker = new LoopBreaker(buildLoopBreakerConfigFromEnv());
        const trustedTelemetryConfig: TrustedTelemetryConfig = buildTrustedTelemetryConfigFromEnv();
        (runtime as any)[ROUTING_CACHE_RUNTIME_KEY] = cacheStore;
        (runtime as any)[RUN_STATE_RUNTIME_KEY] = runState;
        (runtime as any)[LOOP_BREAKER_RUNTIME_KEY] = loopBreaker;
        (runtime as any)[TRUSTED_TELEMETRY_RUNTIME_KEY] = trustedTelemetryConfig;

        const degradeForceSmall = process.env.DEGRADE_FORCE_SMALL === '1';
        const degradeMaxTokens = Number(process.env.DEGRADE_MAX_TOKENS) || null;
        const crmLowRiskMaxTokens = resolveCrmLowRiskCap();
        const cacheMaxEntries = parseIntegerEnv(
            process.env.ROUTING_CACHE_MAX_ENTRIES,
            DEFAULT_CACHE_MAX_ENTRIES,
            1,
            MAX_CACHE_MAX_ENTRIES
        );
        const { smallModel, largeModel } = resolveModelSettings(runtime);
        logRoutingConfiguration(runtime, {
            smallModel,
            largeModel,
            degradeForceSmall,
            degradeMaxTokens,
            cacheMaxEntries,
            crmLowRiskMaxTokens,
        });
        runtime.logger.info(
            {
                src: 'routing',
                run_state: runState.getConfig(),
                loop_breaker: loopBreaker.getConfig(),
                trusted_telemetry: trustedTelemetryConfig,
            },
            'routing_reliability_config'
        );

        runtime.useModel = (async (modelType: any, params: any, provider?: string) => {
            const isTextGen =
                modelType === ModelType.TEXT_SMALL ||
                modelType === ModelType.TEXT_LARGE ||
                modelType === ModelType.TEXT_REASONING_SMALL ||
                modelType === ModelType.TEXT_REASONING_LARGE;

            if (!isTextGen) {
                return originalUseModel(modelType, params, provider);
            }

            const promptText = getPromptText(params);
            const intentText = getIntentSignalText(params);
            const inferredIntentInfo = detectIntent(intentText || promptText);
            const telemetryCandidate = extractTrustedTelemetryCandidate(
                params && typeof params === 'object' && !Array.isArray(params)
                    ? (params as Record<string, unknown>)
                    : null
            );
            const telemetryValidation = validateTrustedTelemetryCandidate(
                telemetryCandidate,
                trustedTelemetryConfig,
                Date.now()
            );
            const trustedHint = telemetryValidation.trusted ? telemetryValidation.hint : null;
            const intentInfo = trustedHint
                ? {
                    intent: trustedHint.intent,
                    risk: trustedHint.risk ?? resolveRiskForIntent(trustedHint.intent),
                }
                : inferredIntentInfo;
            const decision = routeForIntent(intentInfo);
            if (telemetryCandidate && !telemetryValidation.trusted && telemetryValidation.reason !== 'disabled') {
                const rejectionPayload = {
                    src: 'routing',
                    reason: telemetryValidation.reason,
                    intent_fallback: inferredIntentInfo.intent,
                };
                runtime.logger.warn(rejectionPayload, 'routing_trusted_telemetry_rejected');
                await persistRoutingLog(runtime, 'routing:trusted_telemetry_rejected', rejectionPayload);
            }
            const chosenModel = degradeForceSmall ? ModelType.TEXT_SMALL : decision.modelType;
            const baseRouteReason = trustedHint
                ? `trusted_telemetry_${trustedHint.source}`
                : decision.reason;
            const routeReason = degradeForceSmall ? `degrade_force_small|${baseRouteReason}` : baseRouteReason;
            const channel = runtime.character?.name || 'unknown';
            const isCrm = runtime.character?.settings?.CRM_AGENT === true;
            const isCrmLowRisk = isCrm && intentInfo.risk === 'low';

            const cacheSubject = intentText || promptText;
            const shouldCache = chosenModel === ModelType.TEXT_SMALL && isCacheable(cacheSubject, intentInfo);
            const cacheKey = shouldCache ? normalizeKey(`${intentInfo.intent}|${cacheSubject}`) : '';
            const now = Date.now();
            maintainCache(cacheStore, now, cacheMaxEntries);
            const enableLoopGuard = !shouldCache;
            let loopKey: string | null = null;
            if (enableLoopGuard) {
                const loopAttempt = loopBreaker.beforeAttempt({
                    agent: channel,
                    intent: intentInfo.intent,
                    routeReason,
                    requestedModel: String(modelType),
                    promptText: cacheSubject || promptText || '',
                }, now);
                loopKey = loopAttempt.key;
                if (loopAttempt.decision.triggered) {
                    const loopPayload = {
                        src: 'routing',
                        agent: channel,
                        model: chosenModel,
                        requestedModel: modelType,
                        route_reason: routeReason,
                        intent: intentInfo.intent,
                        intent_risk: intentInfo.risk,
                        loop_breaker_code: loopAttempt.decision.code,
                        loop_breaker_reason: loopAttempt.decision.reason,
                        run_state: runState.getSnapshot(now).state,
                    };
                    runtime.logger.warn(loopPayload, 'routing_loop_breaker');
                    await persistRoutingLog(runtime, 'routing:loop_breaker', loopPayload);

                    if (loopAttempt.decision.fallbackResponse) {
                        runState.registerSuccess(now);
                        return loopAttempt.decision.fallbackResponse as any;
                    }
                    const loopError = new Error(
                        `[DEXTER_LOOP_BREAKER_TRIGGERED] ${loopAttempt.decision.reason ?? 'no_progress_detected'}`
                    );
                    (loopError as Error & { name: string }).name = 'DEXTER_LOOP_BREAKER_TRIGGERED';
                    throw loopError;
                }
            }

            if (shouldCache && cacheStore.has(cacheKey)) {
                const entry = cacheStore.get(cacheKey)!;
                if (entry.expiresAt > now) {
                    entry.lastAccessedAt = now;
                    const cacheHitPayload = {
                        src: 'routing',
                        agent: channel,
                        model: entry.model,
                        requestedModel: modelType,
                        route_reason: entry.routeReason,
                        intent: intentInfo.intent,
                        intent_risk: intentInfo.risk,
                        knowledge_segmented: false,
                        cache: 'hit',
                        prompt_tokens: estimateTokens(promptText),
                        completion_tokens: estimateTokens(entry.value),
                        total_tokens: estimateTokens(promptText) + estimateTokens(entry.value),
                        latency_ms: 0,
                        degrade_force_small: degradeForceSmall,
                        degrade_max_tokens: degradeMaxTokens ?? undefined,
                        run_state: runState.getSnapshot(now).state,
                        trusted_telemetry_source: trustedHint?.source,
                    };

                    runtime.logger.info(cacheHitPayload, 'model_used');
                    await persistRoutingLog(runtime, 'routing:model_used', cacheHitPayload);
                    runState.registerSuccess(now);
                    if (loopKey) {
                        loopBreaker.registerSuccess(loopKey, entry.value);
                    }
                    return entry.value as any;
                }
                cacheStore.delete(cacheKey);
            }

            const start = Date.now();
            try {
                // Apply knowledge segmentation (P1.3): swap full KB with intent-relevant sections
                const paramsSegmented = applyKnowledgeSegmentation(params, intentInfo.intent);

                const paramsWithDegradeCaps = (() => {
                    const base = paramsSegmented ?? params;
                    if (!base || typeof base !== 'object' || Array.isArray(base)) return base;
                    const next = { ...(base as Record<string, unknown>) };
                    const currentMax = typeof next.maxTokens === 'number' ? next.maxTokens : undefined;
                    const capList: number[] = [];
                    if (degradeMaxTokens) capList.push(degradeMaxTokens);
                    if (isCrmLowRisk) capList.push(crmLowRiskMaxTokens);
                    if (!capList.length) {
                        return next;
                    }
                    const cap = Math.min(...capList);
                    next.maxTokens = currentMax ? Math.min(currentMax, cap) : cap;
                    return next;
                })();
                const runStateDecision = runState.beforeModelCall(chosenModel, now);
                const effectiveModel = runStateDecision.forceModel ?? chosenModel;
                const paramsWithCaps = applyTokenCap(
                    paramsWithDegradeCaps as Record<string, unknown> | null | undefined,
                    runStateDecision.maxTokensCap
                );
                const effectiveRouteReason = runStateDecision.reason
                    ? `${routeReason}|${runStateDecision.reason}`
                    : routeReason;

                if (runStateDecision.bypass) {
                    const hardHaltError = new Error('[DEXTER_RUNSTATE_HALTED] Model call bypassed by hard halt');
                    (hardHaltError as Error & { name: string }).name = 'DEXTER_RUNSTATE_HALTED';
                    throw hardHaltError;
                }

                const response = await (originalUseModel as any)(effectiveModel, paramsWithCaps, provider);

                // Estimate tokens after segmentation for accurate logging
                const segmentedPromptText = getPromptText(paramsWithCaps as any);
                const promptTokens = estimateTokens(segmentedPromptText || promptText);
                const latencyMs = Date.now() - start;
                const completionText = typeof response === 'string' ? response : undefined;
                const completionTokens = estimateTokens(completionText);

                const knowledgeSegmented = intentInfo.intent !== 'unknown';

                if (shouldCache && typeof response === 'string') {
                    cacheStore.set(cacheKey, {
                        value: response,
                        expiresAt: now + CACHE_TTL_MS,
                        createdAt: now,
                        lastAccessedAt: now,
                        model: effectiveModel,
                        routeReason: effectiveRouteReason,
                    });
                    maintainCache(cacheStore, now, cacheMaxEntries);
                }

                const logPayload = {
                    src: 'routing',
                    agent: channel,
                    model: effectiveModel,
                    requestedModel: modelType,
                    route_reason: effectiveRouteReason,
                    intent: intentInfo.intent,
                    intent_risk: intentInfo.risk,
                    knowledge_segmented: knowledgeSegmented,
                    cache: shouldCache ? 'miss' : 'skipped',
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    total_tokens: promptTokens + completionTokens,
                    latency_ms: latencyMs,
                    degrade_force_small: degradeForceSmall,
                    degrade_max_tokens: degradeMaxTokens ?? undefined,
                    crm_low_risk_max_tokens: isCrmLowRisk ? crmLowRiskMaxTokens : undefined,
                    run_state: runStateDecision.state,
                    run_state_bypass: runStateDecision.bypass,
                    run_state_max_tokens_cap: runStateDecision.maxTokensCap ?? undefined,
                    trusted_telemetry_source: trustedHint?.source,
                    trusted_telemetry_reason: telemetryValidation.reason,
                };

                runtime.logger.info(logPayload, 'model_used');
                await persistRoutingLog(runtime, 'routing:model_used', logPayload);
                runState.registerSuccess();
                if (loopKey) {
                    loopBreaker.registerSuccess(loopKey, typeof response === 'string' ? response : null);
                }

                return response;
            } catch (err) {
                const latencyMs = Date.now() - start;
                const transition = runState.registerError();
                const runStateSnapshot = runState.getSnapshot();
                const errorType = err instanceof Error ? err.name : typeof err;
                if (loopKey) {
                    loopBreaker.registerError(loopKey, errorType);
                }

                if (transition.changed) {
                    const transitionPayload = {
                        src: 'routing',
                        agent: channel,
                        previous_state: transition.previous,
                        next_state: transition.current,
                        consecutive_errors: runStateSnapshot.consecutiveErrors,
                        errors_in_window: runStateSnapshot.errorsInWindow,
                    };
                    runtime.logger.warn(transitionPayload, 'routing_run_state_transition');
                    await persistRoutingLog(runtime, 'routing:run_state_transition', transitionPayload);
                }

                const errorPayload = {
                    src: 'routing',
                    agent: channel,
                    model: chosenModel,
                    requestedModel: modelType,
                    route_reason: routeReason,
                    intent: intentInfo.intent,
                    intent_risk: intentInfo.risk,
                    cache: shouldCache ? 'miss' : 'skipped',
                    prompt_tokens: estimateTokens(promptText),
                    completion_tokens: 0,
                    total_tokens: estimateTokens(promptText),
                    latency_ms: latencyMs,
                    error_type: errorType,
                    degrade_force_small: degradeForceSmall,
                    degrade_max_tokens: degradeMaxTokens ?? undefined,
                    crm_low_risk_max_tokens: isCrmLowRisk ? crmLowRiskMaxTokens : undefined,
                    run_state: runStateSnapshot.state,
                    run_state_consecutive_errors: runStateSnapshot.consecutiveErrors,
                    run_state_errors_in_window: runStateSnapshot.errorsInWindow,
                    trusted_telemetry_source: trustedHint?.source,
                    trusted_telemetry_reason: telemetryValidation.reason,
                };

                runtime.logger.error(errorPayload, 'model_used_error');
                await persistRoutingLog(runtime, 'routing:model_used_error', errorPayload);
                throw err;
            }
        }) as any;
    },
};
