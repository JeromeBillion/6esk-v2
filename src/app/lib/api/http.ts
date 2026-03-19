export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function parseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}

function errorMessageFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  const details = (payload as { details?: unknown }).details;
  if (typeof details === "string" && details.trim()) {
    return details;
  }
  return null;
}

export async function apiFetch<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new ApiError(
      errorMessageFromPayload(payload) ?? `Request failed with status ${response.status}`,
      response.status,
      payload
    );
  }

  return payload as T;
}
