import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { HouseholdSnapshot, RingVisitorEvent, ServerEvent } from '@alongside/shared';
import { Api } from './api';

/**
 * One live connection to the shared backend, shared by every page.
 *
 * The snapshot in here is the single source of truth the dashboard, the voice
 * client and the TV preview all render. A dropped connection is shown rather
 * than hidden, and reconnecting re-reads the snapshot instead of replaying
 * missed events, so a client can never quietly diverge.
 */

export type Connection = 'connecting' | 'live' | 'offline';

interface AlongsideState {
  api: Api;
  token: string;
  setToken(token: string): void;
  snapshot: HouseholdSnapshot | null;
  connection: Connection;
  /** The last thing the assistant said, pushed from the server. */
  lastSpoken: { text: string; occurrenceId: string | null; at: number } | null;
  lastRingEvent: RingVisitorEvent | null;
  refresh(): Promise<void>;
  error: string | null;
  clearError(): void;
  reportError(error: unknown): void;
}

const Context = createContext<AlongsideState | null>(null);

export function AlongsideProvider({
  tokenKey,
  defaultToken,
  children,
}: {
  tokenKey: string;
  defaultToken: string;
  children: React.ReactNode;
}) {
  const [token, setTokenState] = useState<string>(() => localStorage.getItem(tokenKey) ?? defaultToken);
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [lastSpoken, setLastSpoken] = useState<AlongsideState['lastSpoken']>(null);
  const [lastRingEvent, setLastRingEvent] = useState<RingVisitorEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => new Api(token), [token]);
  const retry = useRef(0);

  const setToken = useCallback(
    (next: string) => {
      localStorage.setItem(tokenKey, next);
      setTokenState(next);
      setSnapshot(null);
      setConnection('connecting');
    },
    [tokenKey],
  );

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not reach the backend.');
      throw e;
    }
  }, [api]);

  useEffect(() => {
    if (!token) {
      setConnection('offline');
      return;
    }
    let source: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
      source.onopen = () => {
        retry.current = 0;
        setConnection('live');
      };
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as ServerEvent;
        switch (event.type) {
          case 'snapshot':
            setSnapshot(event.snapshot);
            break;
          case 'occurrence_due':
            setSnapshot(event.snapshot);
            break;
          case 'speak':
            setLastSpoken({ text: event.text, occurrenceId: event.occurrenceId, at: Date.now() });
            break;
          case 'ring_event':
            setLastRingEvent(event.event);
            setSnapshot(event.snapshot);
            break;
          case 'ping':
            break;
        }
      };
      source.onerror = () => {
        source?.close();
        setConnection('offline');
        // Back off, but keep trying: a television may be on a flaky network.
        retry.current = Math.min(retry.current + 1, 6);
        reconnectTimer = window.setTimeout(connect, 500 * 2 ** retry.current);
      };
    };

    refresh().catch(() => setConnection('offline'));
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [token, refresh]);

  const value: AlongsideState = {
    api,
    token,
    setToken,
    snapshot,
    connection,
    lastSpoken,
    lastRingEvent,
    refresh,
    error,
    clearError: () => setError(null),
    reportError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAlongside(): AlongsideState {
  const value = useContext(Context);
  if (!value) throw new Error('useAlongside must be used inside AlongsideProvider');
  return value;
}
