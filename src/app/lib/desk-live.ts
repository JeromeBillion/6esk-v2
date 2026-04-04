import type { DeskLiveNotificationItem, DeskLiveSnapshot } from "@/app/lib/api/desk";

export const DESK_LIVE_EVENT_NAME = "sixesk:desk-live";

export type DeskLiveEventDetail = {
  snapshot: DeskLiveSnapshot;
  supportVersionChanged: boolean;
  inboxVersionChanged: boolean;
};

const DESK_AUDIO_PATHS = {
  email: "/audio/email-notification.mp3",
  chat: "/audio/whatsapp-notification.mp3",
  call: "/audio/call-ringtone.mp3"
} as const;

let activeRingtoneAudio: HTMLAudioElement | null = null;

function getAudioContext() {
  const AudioContextCtor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : null;
  if (!AudioContextCtor) {
    return null;
  }
  return new AudioContextCtor();
}

async function playFallbackTone(kind: "email" | "chat" | "call") {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const patterns: Record<typeof kind, Array<{ frequency: number; durationMs: number; gain: number; delayMs: number }>> = {
    email: [{ frequency: 880, durationMs: 110, gain: 0.03, delayMs: 0 }],
    chat: [
      { frequency: 720, durationMs: 90, gain: 0.025, delayMs: 0 },
      { frequency: 920, durationMs: 110, gain: 0.03, delayMs: 140 }
    ],
    call: [
      { frequency: 620, durationMs: 260, gain: 0.04, delayMs: 0 },
      { frequency: 760, durationMs: 260, gain: 0.04, delayMs: 320 }
    ]
  };

  const startedSuspended = context.state === "suspended";
  if (startedSuspended) {
    await context.resume().catch(() => {});
  }

  const now = context.currentTime;
  for (const tone of patterns[kind]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "call" ? "triangle" : "sine";
    oscillator.frequency.value = tone.frequency;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const startTime = now + tone.delayMs / 1000;
    const endTime = startTime + tone.durationMs / 1000;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(tone.gain, startTime + 0.02);
    gain.gain.linearRampToValueAtTime(0, endTime);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
  }
}

async function playAudioAsset(kind: "email" | "chat" | "call", { loop = false }: { loop?: boolean } = {}) {
  if (typeof window === "undefined") {
    return false;
  }

  const audio = new Audio(DESK_AUDIO_PATHS[kind]);
  audio.preload = "auto";
  audio.loop = loop;
  try {
    audio.currentTime = 0;
    await audio.play();
    if (loop) {
      if (activeRingtoneAudio && activeRingtoneAudio !== audio) {
        activeRingtoneAudio.pause();
        activeRingtoneAudio.currentTime = 0;
      }
      activeRingtoneAudio = audio;
    }
    return true;
  } catch {
    audio.pause();
    return false;
  }
}

export async function playDeskTone(kind: "email" | "chat" | "call") {
  const played = await playAudioAsset(kind);
  if (!played) {
    await playFallbackTone(kind);
  }
}

export async function startDeskRingtone() {
  const played = await playAudioAsset("call", { loop: true });
  if (!played) {
    await playFallbackTone("call");
  }
}

export function stopDeskRingtone() {
  if (!activeRingtoneAudio) {
    return;
  }
  activeRingtoneAudio.pause();
  activeRingtoneAudio.currentTime = 0;
  activeRingtoneAudio = null;
}

export function dispatchDeskLiveEvent(detail: DeskLiveEventDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<DeskLiveEventDetail>(DESK_LIVE_EVENT_NAME, { detail }));
}

export function buildDeskNotificationCopy(item: DeskLiveNotificationItem) {
  if (item.channel === "support_email") {
    return {
      title: "New support email",
      message: item.subject ?? item.preview ?? item.from ?? "A new support email arrived."
    };
  }
  if (item.channel === "whatsapp") {
    return {
      title: "New WhatsApp message",
      message: item.preview ?? item.subject ?? item.from ?? "A new WhatsApp message arrived."
    };
  }
  return {
    title: "New inbox email",
    message: item.subject ?? item.preview ?? item.from ?? "A new inbox email arrived."
  };
}
