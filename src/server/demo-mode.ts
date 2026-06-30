import { cookies } from "next/headers";
import { DEMO_MODE_COOKIE_NAME, parseDemoModeValue, parseDemoQueryValue } from "@/app/lib/demo-mode-config";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>
  | undefined;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export async function isServerDemoModeEnabled(searchParams?: SearchParamsInput) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const queryMode = parseDemoQueryValue(firstValue(resolvedSearchParams?.demo));
  if (typeof queryMode === "boolean") {
    return queryMode;
  }

  const cookieStore = await cookies();
  return parseDemoModeValue(cookieStore.get(DEMO_MODE_COOKIE_NAME)?.value ?? null) ?? false;
}

export function isRequestDemoModeEnabled(
  request: Request,
  options: { defaultEnabled?: boolean } = {}
) {
  const requestUrl = new URL(request.url);
  const queryMode = parseDemoQueryValue(requestUrl.searchParams.get("demo"));
  if (typeof queryMode === "boolean") {
    return queryMode;
  }

  const cookieMode = parseDemoModeValue(
    readCookieValue(request.headers.get("cookie"), DEMO_MODE_COOKIE_NAME)
  );
  if (typeof cookieMode === "boolean") {
    return cookieMode;
  }

  return options.defaultEnabled ?? false;
}
