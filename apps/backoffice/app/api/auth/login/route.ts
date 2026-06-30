import {
  BACKOFFICE_ACCESS_EMAIL_HEADER,
  shouldRequireCloudflareAccess
} from "@6esk/auth/cloudflare-access";
import { POST as productLogin } from "../../../../../../src/app/api/auth/login/route";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

export async function POST(request: Request) {
  if (!shouldRequireCloudflareAccess()) {
    return productLogin(request);
  }

  let payload: unknown;
  try {
    payload = await request.clone().json();
  } catch {
    return productLogin(request);
  }

  const requestedEmail =
    payload && typeof payload === "object" && "email" in payload
      ? normalizeEmail((payload as { email?: unknown }).email)
      : null;
  const accessEmail = normalizeEmail(request.headers.get(BACKOFFICE_ACCESS_EMAIL_HEADER));
  if (!requestedEmail || !accessEmail || requestedEmail !== accessEmail) {
    return Response.json(
      { error: "Cloudflare Access identity must match the 6esk Work login email." },
      { status: 403 }
    );
  }

  return productLogin(request);
}
