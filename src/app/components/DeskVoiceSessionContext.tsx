"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { VoicePresenceStatus } from "@/app/lib/api/calls";

export type DeskVoiceCallDetails = {
  callSessionId: string | null;
  ticketId: string | null;
  fromPhone: string | null;
  toPhone: string | null;
  direction: string | null;
};

type DeskVoiceSessionSnapshot = {
  enabledForUser: boolean;
  voiceEnabled: boolean;
  presence: VoicePresenceStatus;
  sdkStatus: "idle" | "registering" | "ready" | "error";
  sdkError: string | null;
  incomingCall: DeskVoiceCallDetails | null;
  activeCall: DeskVoiceCallDetails | null;
  muted: boolean;
  holdActive: boolean;
  controlsAvailable: boolean;
};

type DeskVoiceSessionControls = {
  answerIncoming: () => void;
  passIncoming: () => void;
  endActiveCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  sendDigits: (digits: string) => void;
};

type DeskVoiceSessionContextValue = DeskVoiceSessionSnapshot &
  DeskVoiceSessionControls & {
    publishSession: (snapshot: DeskVoiceSessionSnapshot) => void;
    registerControls: (controls: DeskVoiceSessionControls) => () => void;
  };

const emptySnapshot: DeskVoiceSessionSnapshot = {
  enabledForUser: false,
  voiceEnabled: false,
  presence: "offline",
  sdkStatus: "idle",
  sdkError: null,
  incomingCall: null,
  activeCall: null,
  muted: false,
  holdActive: false,
  controlsAvailable: false
};

const emptyControls: DeskVoiceSessionControls = {
  answerIncoming: () => {},
  passIncoming: () => {},
  endActiveCall: () => {},
  toggleMute: () => {},
  toggleHold: () => {},
  sendDigits: () => {}
};

const DeskVoiceSessionContext = createContext<DeskVoiceSessionContextValue | null>(null);

export function DeskVoiceSessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<DeskVoiceSessionSnapshot>(emptySnapshot);
  const [controls, setControls] = useState<DeskVoiceSessionControls>(emptyControls);

  const publishSession = useCallback((nextSnapshot: DeskVoiceSessionSnapshot) => {
    setSnapshot(nextSnapshot);
  }, []);

  const registerControls = useCallback((nextControls: DeskVoiceSessionControls) => {
    setControls(nextControls);
    return () => {
      setControls(emptyControls);
    };
  }, []);

  const value = useMemo(
    () => ({
      ...snapshot,
      ...controls,
      publishSession,
      registerControls
    }),
    [controls, publishSession, registerControls, snapshot]
  );

  return (
    <DeskVoiceSessionContext.Provider value={value}>
      {children}
    </DeskVoiceSessionContext.Provider>
  );
}

export function useDeskVoiceSession() {
  const context = useContext(DeskVoiceSessionContext);
  if (!context) {
    return {
      ...emptySnapshot,
      ...emptyControls,
      publishSession: () => {},
      registerControls: () => () => {}
    } satisfies DeskVoiceSessionContextValue;
  }
  return context;
}
