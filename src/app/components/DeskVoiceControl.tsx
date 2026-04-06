"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, PhoneCall, PhoneIncoming, PhoneOff, UserRound } from "lucide-react";
import type { CurrentSessionUser } from "@/app/lib/api/session";
import {
  getDeskVoiceClientToken,
  getVoicePresence,
  patchVoicePresence,
  type VoicePresenceStatus
} from "@/app/lib/api/calls";
import {
  DESK_LIVE_EVENT_NAME,
  startDeskRingtone,
  stopDeskRingtone,
  type DeskLiveEventDetail
} from "@/app/lib/desk-live";
import { Button } from "@/app/workspace/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/app/workspace/components/ui/dropdown-menu";
import { cn } from "@/app/workspace/components/ui/utils";

type DeskVoiceControlProps = {
  currentUser: CurrentSessionUser | null;
  demoModeEnabled: boolean;
};

type TwilioDevice = import("@twilio/voice-sdk").Device;
type TwilioCall = import("@twilio/voice-sdk").Call;

type IncomingCallDetails = {
  callSessionId: string | null;
  ticketId: string | null;
  fromPhone: string | null;
  toPhone: string | null;
  direction: string | null;
};

function prettyPresenceLabel(status: VoicePresenceStatus) {
  if (status === "online") return "Online";
  if (status === "away") return "Away";
  return "Offline";
}

function readCallDetails(call: TwilioCall): IncomingCallDetails {
  const custom = call.customParameters;
  return {
    callSessionId: custom.get("callSessionId") ?? null,
    ticketId: custom.get("ticketId") ?? null,
    fromPhone: custom.get("fromPhone") ?? call.parameters.From ?? null,
    toPhone: custom.get("toPhone") ?? call.parameters.To ?? null,
    direction: custom.get("direction") ?? null
  };
}

function getUserInitials(user: CurrentSessionUser | null) {
  if (!user) return "D";
  const words = user.display_name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (words[0]?.slice(0, 2) ?? user.email.slice(0, 2)).toUpperCase();
}

export function DeskVoiceControl({ currentUser, demoModeEnabled }: DeskVoiceControlProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [presence, setPresence] = useState<VoicePresenceStatus>("offline");
  const [presenceLoading, setPresenceLoading] = useState(true);
  const [sdkStatus, setSdkStatus] = useState<"idle" | "registering" | "ready" | "error">("idle");
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<TwilioCall | null>(null);
  const [incomingDetails, setIncomingDetails] = useState<IncomingCallDetails | null>(null);
  const [activeCall, setActiveCall] = useState<TwilioCall | null>(null);
  const [activeDetails, setActiveDetails] = useState<IncomingCallDetails | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [operatorSummary, setOperatorSummary] = useState({
    online: 0,
    ringing: 0,
    busy: 0,
    away: 0,
    offline: 0
  });
  const [operatorRoster, setOperatorRoster] = useState<
    Array<{
      userId: string;
      displayName: string;
      email: string;
      status: VoicePresenceStatus;
      activeCallSessionId: string | null;
      ringingCallSessionId: string | null;
    }>
  >([]);
  const deviceRef = useRef<TwilioDevice | null>(null);
  const mountedRef = useRef(true);

  const enabledForUser = Boolean(currentUser && !demoModeEnabled);
  const canReceiveCalls = enabledForUser && voiceEnabled;

  const cleanupCall = useCallback(async (callSessionId: string | null) => {
    setIncomingCall(null);
    setIncomingDetails(null);
    setActiveCall(null);
    setActiveDetails(null);
    if (callSessionId) {
      try {
        await patchVoicePresence({ activeCallSessionId: null });
      } catch {}
    }
  }, []);

  const attachCallLifecycle = useCallback(
    (call: TwilioCall) => {
      const details = readCallDetails(call);
      const handleAccepted = () => {
        setIncomingCall(null);
        setIncomingDetails(null);
        setActiveCall(call);
        setActiveDetails(details);
        void patchVoicePresence({
          status: "online",
          activeCallSessionId: details.callSessionId,
          registered: true
        }).catch(() => {});
      };

      const handleFinished = () => {
        void cleanupCall(details.callSessionId);
      };

      call.on("accept", handleAccepted);
      call.on("cancel", handleFinished);
      call.on("disconnect", handleFinished);
      call.on("reject", handleFinished);
      call.on("error", handleFinished);
    },
    [cleanupCall]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleDeskLiveEvent = (event: Event) => {
      const detail = (event as CustomEvent<DeskLiveEventDetail>).detail;
      if (!detail?.snapshot) return;
      setOperatorSummary(detail.snapshot.operators.summary);
      setOperatorRoster(detail.snapshot.operators.roster);
    };
    window.addEventListener(DESK_LIVE_EVENT_NAME, handleDeskLiveEvent as EventListener);
    return () => {
      window.removeEventListener(DESK_LIVE_EVENT_NAME, handleDeskLiveEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!enabledForUser) {
      setPresence("offline");
      setVoiceEnabled(false);
      setPresenceLoading(false);
      return;
    }

    let cancelled = false;
    setPresenceLoading(true);
    void getVoicePresence()
      .then((payload) => {
        if (cancelled) return;
        setVoiceEnabled(payload.voiceEnabled);
        setPresence(payload.presence.status);
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceEnabled(false);
          setPresence("offline");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPresenceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabledForUser]);

  useEffect(() => {
    if (!enabledForUser || !canReceiveCalls || presence !== "online") {
      if (deviceRef.current) {
        const existing = deviceRef.current;
        deviceRef.current = null;
        setSdkStatus("idle");
        setSdkError(null);
        void existing.unregister().catch(() => {});
        existing.destroy();
      }
      return;
    }

    let cancelled = false;
    let currentDevice: TwilioDevice | null = null;
    setSdkStatus("registering");
    setSdkError(null);

    void (async () => {
      try {
        const [{ Device }, tokenPayload] = await Promise.all([
          import("@twilio/voice-sdk"),
          getDeskVoiceClientToken()
        ]);
        if (cancelled) return;

        const device = new Device(tokenPayload.accessToken, {
          logLevel: 1,
          closeProtection: false
        });
        currentDevice = device;
        deviceRef.current = device;

        device.on("registered", () => {
          if (cancelled || !mountedRef.current) return;
          setSdkStatus("ready");
          setSdkError(null);
          void patchVoicePresence({ status: "online", registered: true }).catch(() => {});
        });
        device.on("incoming", (call: TwilioCall) => {
          if (cancelled || !mountedRef.current) return;
          const details = readCallDetails(call);
          setIncomingCall(call);
          setIncomingDetails(details);
          attachCallLifecycle(call);
        });
        device.on("error", (error: Error) => {
          if (cancelled || !mountedRef.current) return;
          setSdkStatus("error");
          setSdkError(error.message);
        });

        await device.register();
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        setSdkStatus("error");
        setSdkError(error instanceof Error ? error.message : "Failed to initialize desk calling.");
      }
    })();

    return () => {
      cancelled = true;
      if (currentDevice) {
        void currentDevice.unregister().catch(() => {});
        currentDevice.destroy();
      }
      if (deviceRef.current === currentDevice) {
        deviceRef.current = null;
      }
    };
  }, [attachCallLifecycle, canReceiveCalls, enabledForUser, presence]);

  useEffect(() => {
    if (!enabledForUser || presence === "offline") {
      return;
    }
    const interval = window.setInterval(() => {
      void patchVoicePresence({ status: presence, registered: sdkStatus === "ready" }).catch(() => {});
    }, 30000);
    return () => window.clearInterval(interval);
  }, [enabledForUser, presence, sdkStatus]);

  useEffect(() => {
    if (!incomingCall) {
      stopDeskRingtone();
      return;
    }

    void startDeskRingtone();

    return () => {
      stopDeskRingtone();
    };
  }, [incomingCall]);

  const changePresence = useCallback(
    async (nextStatus: VoicePresenceStatus) => {
      if (!enabledForUser || nextStatus === presence) {
        return;
      }
      setStatusBusy(true);
      try {
        const response = await patchVoicePresence({
          status: nextStatus,
          activeCallSessionId: nextStatus === "offline" ? null : activeDetails?.callSessionId ?? null,
          registered: nextStatus === "online" && sdkStatus === "ready"
        });
        setPresence(response.presence.status);
      } catch (error) {
        setSdkError(error instanceof Error ? error.message : "Failed to update presence.");
      } finally {
        setStatusBusy(false);
      }
    },
    [activeDetails?.callSessionId, enabledForUser, presence, sdkStatus]
  );

  const answerIncoming = useCallback(() => {
    if (!incomingCall) return;
    incomingCall.accept();
  }, [incomingCall]);

  const passIncoming = useCallback(() => {
    if (!incomingCall) return;
    incomingCall.reject();
  }, [incomingCall]);

  const endActiveCall = useCallback(() => {
    activeCall?.disconnect();
  }, [activeCall]);

  const statusTone =
    presence === "online"
      ? "bg-emerald-500"
      : presence === "away"
        ? "bg-amber-500"
        : "bg-neutral-400";

  const supportNumberLabel = useMemo(() => {
    if (incomingDetails?.fromPhone) return incomingDetails.fromPhone;
    if (activeDetails?.fromPhone) return activeDetails.fromPhone;
    return null;
  }, [activeDetails?.fromPhone, incomingDetails?.fromPhone]);
  const userInitials = useMemo(() => getUserInitials(currentUser), [currentUser]);

  if (!enabledForUser) {
    return null;
  }

  return (
    <>
      <DropdownMenu open={panelOpen} onOpenChange={setPanelOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative flex h-12 w-full items-center justify-center rounded-lg transition-colors text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
            title="Desk profile"
            aria-label="Desk profile"
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-[11px] font-semibold tracking-[0.16em] text-neutral-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
              {userInitials}
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-neutral-950",
                  statusTone
                )}
              />
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={14}
          className="w-[340px] rounded-2xl border border-neutral-200 bg-white/96 p-0 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/96 dark:shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
        >
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-semibold tracking-[0.18em] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
                  {userInitials}
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-neutral-950",
                      statusTone
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {currentUser?.display_name ?? "Desk Operator"}
                  </p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{currentUser?.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                {sdkStatus === "registering" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {sdkStatus === "ready" ? "Ready" : sdkStatus === "error" ? "Error" : "Idle"}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200/80 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
              <div className="mb-3 flex items-center gap-2">
                <div className={cn("h-2.5 w-2.5 rounded-full", statusTone)} />
                <div>
                  <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Desk Calls</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {presenceLoading ? "Loading…" : prettyPresenceLabel(presence)}
                  </p>
                </div>
              </div>

              <div className="flex gap-1.5">
                {(["online", "away", "offline"] as const).map((statusOption) => (
                  <Button
                    key={statusOption}
                    type="button"
                    size="sm"
                    variant={presence === statusOption ? "default" : "outline"}
                    className="h-8 flex-1 text-xs"
                    disabled={statusBusy || !voiceEnabled}
                    onClick={() => {
                      void changePresence(statusOption);
                    }}
                  >
                    {prettyPresenceLabel(statusOption)}
                  </Button>
                ))}
              </div>

              {sdkError ? (
                <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{sdkError}</p>
              ) : !voiceEnabled ? (
                <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Voice is not enabled for this workspace.
                </p>
              ) : supportNumberLabel ? (
                <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Current caller: {supportNumberLabel}
                </p>
              ) : (
                <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Set your presence to Online to receive desk calls in the browser.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200/80 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-900 dark:text-neutral-100">
                <UserRound className="h-3.5 w-3.5" />
                Desk profile
              </div>
              <p className="text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
                Keep yourself Online to receive desk calls in-browser. Use Away when you are still signed in but
                should not be auto-rung.
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200/80 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Desk availability</p>
                <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span>Online {operatorSummary.online}</span>
                  <span>Ringing {operatorSummary.ringing}</span>
                  <span>Busy {operatorSummary.busy}</span>
                  <span>Away {operatorSummary.away}</span>
                </div>
              </div>
              <div className="space-y-2">
                {operatorRoster.length ? (
                  operatorRoster.slice(0, 5).map((operator) => {
                    const rosterTone =
                      operator.status === "online"
                        ? operator.activeCallSessionId
                          ? "bg-blue-500"
                          : operator.ringingCallSessionId
                            ? "bg-amber-500"
                          : "bg-emerald-500"
                        : operator.status === "away"
                          ? "bg-amber-500"
                          : "bg-neutral-400";
                    const rosterLabel =
                      operator.status === "online"
                        ? operator.activeCallSessionId
                          ? "In call"
                          : operator.ringingCallSessionId
                            ? "Ringing"
                          : "Available"
                        : operator.status === "away"
                          ? "Away"
                          : "Offline";
                    return (
                      <div key={operator.userId} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
                            {operator.displayName}
                          </p>
                          <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                            {operator.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2.5 w-2.5 rounded-full", rosterTone)} />
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{rosterLabel}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    No active desk operators visible yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {incomingCall && incomingDetails ? (
        <div className="fixed bottom-36 right-5 z-50 w-[360px] rounded-2xl border border-emerald-200 bg-white p-4 shadow-[0_24px_50px_rgba(15,23,42,0.18)] dark:border-emerald-600/40 dark:bg-neutral-950">
          <div className="mb-3 flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <PhoneIncoming className="h-4 w-4" />
            <p className="text-sm font-semibold">Incoming Support Call</p>
          </div>
          <div className="space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
            <p>{incomingDetails.fromPhone ?? "Unknown caller"}</p>
            {incomingDetails.ticketId ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Ticket {incomingDetails.ticketId}</p>
            ) : null}
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" className="flex-1 gap-2" onClick={answerIncoming}>
              <PhoneCall className="h-4 w-4" />
              Answer
            </Button>
            <Button type="button" variant="outline" className="flex-1 gap-2" onClick={passIncoming}>
              <PhoneOff className="h-4 w-4" />
              Pass Onward
            </Button>
          </div>
        </div>
      ) : null}

      {activeCall && activeDetails ? (
        <div className="fixed bottom-36 right-5 z-50 w-[360px] rounded-2xl border border-blue-200 bg-white p-4 shadow-[0_24px_50px_rgba(15,23,42,0.18)] dark:border-blue-600/40 dark:bg-neutral-950">
          <div className="mb-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <Phone className="h-4 w-4" />
            <p className="text-sm font-semibold">In Call</p>
          </div>
          <div className="space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
            <p>{activeDetails.fromPhone ?? "Unknown caller"}</p>
            {activeDetails.ticketId ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Ticket {activeDetails.ticketId}</p>
            ) : null}
          </div>
          <div className="mt-4">
            <Button type="button" variant="outline" className="w-full gap-2" onClick={endActiveCall}>
              <PhoneOff className="h-4 w-4" />
              End Call
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
