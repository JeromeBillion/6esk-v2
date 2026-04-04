import { cookies } from "next/headers";
import { DEMO_MODE_COOKIE_NAME, parseDemoModeValue, parseDemoQueryValue } from "@/app/lib/demo-mode-config";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>
  | undefined;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
