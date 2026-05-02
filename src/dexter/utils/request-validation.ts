import type { RouteRequest, RouteResponse } from '@elizaos/core';

export interface InvalidRequestDetails {
  route: string;
  field?: string;
  reason?: string;
}

export const normalizeRouteBody = <T = Record<string, unknown>>(req: RouteRequest): T => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {} as T;
  }
  return body as T;
};

export const respondInvalidRequest = (
  res: RouteResponse,
  error: string,
  details: InvalidRequestDetails
): void => {
  res.status(400).json({
    success: false,
    code: 'INVALID_REQUEST',
    error,
    details,
  });
};

