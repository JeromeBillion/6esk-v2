import twilio from "twilio";
import { buildDeskVoiceIdentity } from "@/server/calls/operators";

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getClientTokenTtlSeconds() {
  const parsed = Number(process.env.CALLS_TWILIO_CLIENT_TOKEN_TTL_SECONDS ?? "3600");
  if (!Number.isFinite(parsed) || parsed < 300) {
    return 3600;
  }
  return Math.floor(parsed);
}

export function getTwilioClientCredentials() {
  const accountSid = readString(process.env.CALLS_TWILIO_ACCOUNT_SID);
  const apiKeySid = readString(process.env.CALLS_TWILIO_API_KEY_SID);
  const apiKeySecret = readString(process.env.CALLS_TWILIO_API_KEY_SECRET);
  const twimlAppSid = readString(process.env.CALLS_TWILIO_TWIML_APP_SID);

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error(
      "Twilio desk client requires CALLS_TWILIO_ACCOUNT_SID, CALLS_TWILIO_API_KEY_SID, and CALLS_TWILIO_API_KEY_SECRET."
    );
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    twimlAppSid,
    ttl: getClientTokenTtlSeconds()
  };
}

export function createDeskVoiceAccessToken(userId: string) {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid, ttl } = getTwilioClientCredentials();
  const identity = buildDeskVoiceIdentity(userId);
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl });
  token.identity = identity;

  const voiceGrant = new VoiceGrant({
    incomingAllow: true,
    ...(twimlAppSid ? { outgoingApplicationSid: twimlAppSid } : {})
  });
  token.addGrant(voiceGrant);

  return {
    identity,
    token: token.toJwt(),
    expiresInSeconds: ttl
  };
}
