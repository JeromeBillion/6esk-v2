import { cookies } from "next/headers";
import {
  buildAuthOAuthAuthorizeUrl,
  createAuthOAuthState,
  isAuthOAuthProvider,
  sanitizeAuthReturnTo
} from "@/server/auth/oauth-login";

const AUTH_OAUTH_NONCE_COOKIE = "sixesk_auth_oauth_nonce";
const COOKIE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!isAuthOAuthProvider(provider)) {
    return Response.json({ error: "Unsupported auth provider" }, { status: 400 });
  }

  const returnTo = sanitizeAuthReturnTo(url.searchParams.get("returnTo"));
  const { state, encoded } = createAuthOAuthState(provider, returnTo);
  const cookieStore = await cookies();
  cookieStore.set(AUTH_OAUTH_NONCE_COOKIE, state.nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/oauth",
    maxAge: COOKIE_TTL_SECONDS
  });

  try {
    return Response.redirect(buildAuthOAuthAuthorizeUrl(provider, encoded));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

