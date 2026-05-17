import { randomUUID } from "crypto";

export const SIXESK_API_VERSION = "2026-05-17";
const VERSION_HEADER = "x-6esk-api-version";
const REQUEST_ID_HEADER = "x-6esk-request-id";
const SUPPORTED_VERSIONS = new Set([SIXESK_API_VERSION]);

type ApiContractMeta = {
  apiVersion: string;
  requestId: string;
  timestamp: string;
};

type IntegrationErrorInput = {
  status: number;
  code: string;
  message: string;
  detail?: string;
  details?: unknown;
  extra?: Record<string, unknown>;
  apiVersion?: string;
  requestId?: string;
};

type IntegrationSuccessInit = {
  status?: number;
  headers?: HeadersInit;
  apiVersion?: string;
  requestId?: string;
};

function readHeaderValue(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function getIntegrationApiRequestId(request: Request) {
  return (
    readHeaderValue(request.headers.get("x-request-id")) ||
    readHeaderValue(request.headers.get("x-correlation-id")) ||
    readHeaderValue(request.headers.get("cf-ray")) ||
    randomUUID()
  );
}

export function getIntegrationApiVersion(request: Request) {
  return readHeaderValue(request.headers.get(VERSION_HEADER)) ?? SIXESK_API_VERSION;
}

function buildMeta(request: Request, apiVersion?: string, requestId?: string): ApiContractMeta {
  return {
    apiVersion: apiVersion ?? getIntegrationApiVersion(request),
    requestId: requestId ?? getIntegrationApiRequestId(request),
    timestamp: new Date().toISOString()
  };
}

function buildContractHeaders(meta: ApiContractMeta, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set(VERSION_HEADER, meta.apiVersion);
  responseHeaders.set(REQUEST_ID_HEADER, meta.requestId);
  return responseHeaders;
}

export function validateIntegrationApiVersion(
  request: Request,
  options: {
    required?: boolean;
    supportedVersions?: readonly string[];
  } = {}
) {
  const requestedVersion = readHeaderValue(request.headers.get(VERSION_HEADER));
  const supportedVersions = new Set(options.supportedVersions ?? Array.from(SUPPORTED_VERSIONS));
  const required = options.required ?? false;

  if (!requestedVersion && !required) {
    return null;
  }

  if (!requestedVersion && required) {
    return integrationError(request, {
      status: 400,
      code: "missing_api_version",
      message: `${VERSION_HEADER} header is required for this endpoint.`
    });
  }

  if (!requestedVersion) return null;

  if (!supportedVersions.has(requestedVersion)) {
    return integrationError(request, {
      status: 400,
      code: "unsupported_api_version",
      message: `${VERSION_HEADER} value is not supported.`,
      detail: `Supported versions: ${Array.from(supportedVersions).join(", ")}.`,
      apiVersion: requestedVersion
    });
  }

  return null;
}

export function integrationSuccess(
  request: Request,
  payload: unknown,
  init: IntegrationSuccessInit = {}
) {
  const meta = buildMeta(request, init.apiVersion, init.requestId);
  return Response.json(payload, {
    status: init.status ?? 200,
    headers: buildContractHeaders(meta, init.headers)
  });
}

export function integrationError(request: Request, input: IntegrationErrorInput) {
  const meta = buildMeta(request, input.apiVersion, input.requestId);
  return Response.json(
    {
      ok: false,
      code: input.code,
      error: input.message,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(input.extra ?? {}),
      meta
    },
    {
      status: input.status,
      headers: buildContractHeaders(meta)
    }
  );
}
