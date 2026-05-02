import type { Route, RouteRequest, RouteResponse, IAgentRuntime } from '@elizaos/core';

export type RouteScope = 'public' | 'read' | 'execute';

export interface RouteScopeAuthConfig {
  enabled: boolean;
  readToken: string | null;
  executeToken: string | null;
}

const scopeRegistry = new WeakMap<Route, RouteScope>();
export const ROUTE_SCOPE_META_KEY = '__DexterRouteScope';

const parseBooleanEnv = (value: string | undefined, fallback = false): boolean => {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const readHeader = (req: RouteRequest, headerName: string): string | null => {
  const headers = req.headers || {};
  const needle = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle) continue;
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
      return first?.trim() || null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const parseBearerToken = (authorizationHeader: string | null): string | null => {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const extractRequestToken = (req: RouteRequest): string | null => {
  const explicit =
    readHeader(req, 'x-Dexter-auth-token') ||
    readHeader(req, 'x-eliza-auth-token') ||
    readHeader(req, 'x-6esk-agent-key');
  if (explicit) return explicit;
  return parseBearerToken(readHeader(req, 'authorization'));
};

export const resolveRouteScopeAuthConfig = (): RouteScopeAuthConfig => {
  const enabled = parseBooleanEnv(process.env.DEXTER_ROUTE_AUTH_ENABLED, false);
  const executeToken =
    process.env.DEXTER_ROUTE_EXECUTE_TOKEN?.trim() || process.env.ELIZA_SERVER_AUTH_TOKEN?.trim() || null;
  const readToken = process.env.DEXTER_ROUTE_READ_TOKEN?.trim() || executeToken || null;
  return { enabled, readToken, executeToken };
};

const deny = (res: RouteResponse, status: number, code: string, error: string): void => {
  res.status(status).json({
    success: false,
    code,
    error,
  });
};

const allowedTokensForScope = (scope: RouteScope, config: RouteScopeAuthConfig): string[] => {
  if (scope === 'public') return [];
  if (scope === 'execute') {
    return config.executeToken ? [config.executeToken] : [];
  }

  // read scope accepts read token and execute token.
  const tokens = [config.readToken, config.executeToken].filter(Boolean) as string[];
  return Array.from(new Set(tokens));
};

const enforceScopeAuth = (
  req: RouteRequest,
  res: RouteResponse,
  scope: RouteScope,
  config: RouteScopeAuthConfig
): boolean => {
  if (!config.enabled || scope === 'public') return true;

  const allowedTokens = allowedTokensForScope(scope, config);
  if (!allowedTokens.length) {
    deny(
      res,
      503,
      'ROUTE_AUTH_MISCONFIGURED',
      `Auth is enabled but no ${scope} scope token is configured`
    );
    return false;
  }

  const received = extractRequestToken(req);
  if (!received || !allowedTokens.includes(received)) {
    deny(res, 401, 'UNAUTHORIZED', 'Invalid or missing auth token');
    return false;
  }
  return true;
};

export const withRouteScope = (
  route: Route,
  scope: RouteScope,
  options?: { authConfig?: RouteScopeAuthConfig }
): Route => {
  const authConfig = options?.authConfig ?? resolveRouteScopeAuthConfig();
  const originalHandler = route.handler;
  const wrapped: Route = {
    ...route,
    [ROUTE_SCOPE_META_KEY]: scope,
    handler: originalHandler
      ? async (req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime): Promise<void> => {
          if (!enforceScopeAuth(req, res, scope, authConfig)) {
            return;
          }
          await originalHandler(req, res, runtime);
        }
      : undefined,
  };
  scopeRegistry.set(wrapped, scope);
  return wrapped;
};

export const getRouteScope = (route: Route): RouteScope | null => {
  const fromMap = scopeRegistry.get(route);
  if (fromMap) return fromMap;

  const fromMeta = (route as Route & { [ROUTE_SCOPE_META_KEY]?: RouteScope })[ROUTE_SCOPE_META_KEY];
  return fromMeta ?? null;
};

export const assertAllRoutesScoped = (
  routes: Route[],
  options?: { allowPublic?: boolean }
): void => {
  const allowPublic = options?.allowPublic ?? true;
  const unscoped: string[] = [];

  for (const route of routes) {
    const scope = getRouteScope(route);
    if (!scope) {
      unscoped.push(route.path);
      continue;
    }
    if (!allowPublic && scope === 'public') {
      unscoped.push(route.path);
    }
  }

  if (unscoped.length > 0) {
    throw new Error(`Found unscoped routes: ${unscoped.join(', ')}`);
  }
};
