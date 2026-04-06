import { apiFetch } from "@/app/lib/api/http";

export type VoicePresenceStatus = "online" | "away" | "offline";

export type VoicePresenceResponse = {
  voiceEnabled: boolean;
  presence: {
    userId: string;
    status: VoicePresenceStatus;
    activeCallSessionId: string | null;
    ringingCallSessionId: string | null;
    lastSeenAt: string | null;
    registeredAt: string | null;
  };
};

export type VoiceClientTokenResponse = {
  identity: string;
  accessToken: string;
  expiresInSeconds: number;
  presence: VoicePresenceResponse["presence"];
};

export function getVoicePresence() {
  return apiFetch<VoicePresenceResponse>("/api/calls/presence");
}

export function patchVoicePresence(input: {
  status?: VoicePresenceStatus;
  activeCallSessionId?: string | null;
  registered?: boolean;
}) {
  return apiFetch<{ presence: VoicePresenceResponse["presence"] }>("/api/calls/presence", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getDeskVoiceClientToken() {
  return apiFetch<VoiceClientTokenResponse>("/api/calls/client-token");
}
