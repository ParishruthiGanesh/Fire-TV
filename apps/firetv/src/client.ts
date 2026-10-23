import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HouseholdSnapshot, ServerEvent } from '@alongside/shared/src/tv';

/**
 * The Fire TV app's connection to the household.
 *
 * React Native has neither EventSource nor streaming fetch, so this uses the
 * backend's WebSocket endpoint and falls back to polling when the socket
 * cannot be held open. Either way the app renders server state and never
 * invents any: when the connection drops it says so on screen rather than
 * showing stale information as if it were live.
 */

const KEY_BASE_URL = 'alongside.baseUrl';
const KEY_TOKEN = 'alongside.deviceToken';

export interface Connection {
  status: 'connecting' | 'live' | 'offline';
  via: 'socket' | 'polling' | null;
}

export class TvClient {
  private socket: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = false;

  constructor(
    public baseUrl: string,
    public token: string,
    private readonly onSnapshot: (snapshot: HouseholdSnapshot) => void,
    private readonly onEvent: (event: ServerEvent) => void,
    private readonly onConnection: (connection: Connection) => void,
  ) {}

  static async loadSettings(): Promise<{ baseUrl: string | null; token: string | null }> {
    const [baseUrl, token] = await Promise.all([
      AsyncStorage.getItem(KEY_BASE_URL),
      AsyncStorage.getItem(KEY_TOKEN),
    ]);
    return { baseUrl, token };
  }

  static async saveSettings(baseUrl: string, token: string): Promise<void> {
    await AsyncStorage.multiSet([
      [KEY_BASE_URL, baseUrl],
      [KEY_TOKEN, token],
    ]);
  }

  static async clearSettings(): Promise<void> {
    await AsyncStorage.multiRemove([KEY_BASE_URL, KEY_TOKEN]);
  }

  static async pair(baseUrl: string, code: string): Promise<{ token: string; householdName: string }> {
    const response = await fetch(`${normalise(baseUrl)}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase(), kind: 'tv', label: 'Fire TV' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error ?? 'That code was not recognised.');
    return { token: body.token, householdName: body.household?.name ?? 'your household' };
  }

  // -------------------------------------------------------------- lifecycle

  start(): void {
    this.stopped = false;
    this.onConnection({ status: 'connecting', via: null });
    void this.refresh();
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.retryTimer = null;
  }

  private openSocket(): void {
    if (this.stopped) return;
    const wsUrl = `${normalise(this.baseUrl).replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(this.token)}`;
    try {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      socket.onopen = () => {
        this.retries = 0;
        this.stopPolling();
        this.onConnection({ status: 'live', via: 'socket' });
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as ServerEvent;
          if (event.type === 'snapshot' || event.type === 'occurrence_due' || event.type === 'ring_event') {
            this.onSnapshot(event.snapshot);
          }
          this.onEvent(event);
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };
      socket.onerror = () => this.handleDrop();
      socket.onclose = () => this.handleDrop();
    } catch {
      this.handleDrop();
    }
  }

  private handleDrop(): void {
    if (this.stopped) return;
    this.socket = null;
    this.onConnection({ status: 'offline', via: null });
    // Keep the screen truthful by polling while the socket is down.
    this.startPolling();
    this.retries = Math.min(this.retries + 1, 6);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.openSocket(), 1000 * 2 ** Math.min(this.retries, 4));
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async refresh(): Promise<void> {
    try {
      const snapshot = await this.get<HouseholdSnapshot>('/api/snapshot');
      this.onSnapshot(snapshot);
      if (!this.socket) this.onConnection({ status: 'live', via: 'polling' });
    } catch {
      this.onConnection({ status: 'offline', via: null });
    }
  }

  // ------------------------------------------------------------------- api

  mediaUrl(assetId: string | null | undefined): string | null {
    if (!assetId) return null;
    return `${normalise(this.baseUrl)}/media/${assetId}?token=${encodeURIComponent(this.token)}`;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${normalise(this.baseUrl)}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${normalise(this.baseUrl)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    return payload as T;
  }

  /** Every command carries a key so a double press cannot apply twice. */
  command(occurrenceId: string, action: 'start' | 'repeat' | 'back' | 'complete' | 'skip'): Promise<unknown> {
    return this.post(`/api/occurrences/${occurrenceId}/${action}`, {
      surface: 'tv',
      idempotencyKey: key(action, occurrenceId),
    });
  }

  advance(occurrenceId: string, confirmedStepIndex: number): Promise<unknown> {
    return this.post(`/api/occurrences/${occurrenceId}/advance`, {
      confirmedStepIndex,
      surface: 'tv',
      idempotencyKey: key(`advance-${confirmedStepIndex}`, occurrenceId),
    });
  }

  postpone(occurrenceId: string, minutes: number): Promise<unknown> {
    return this.post(`/api/occurrences/${occurrenceId}/postpone`, {
      minutes,
      surface: 'tv',
      idempotencyKey: key(`postpone-${minutes}`, occurrenceId),
    });
  }

  requestHelp(occurrenceId: string | null, message: string): Promise<unknown> {
    return this.post('/api/help-requests', {
      occurrenceId,
      message,
      surface: 'tv',
      idempotencyKey: key('help', occurrenceId ?? 'none'),
    });
  }

  /**
   * Tell the assistant what the person chose.
   *
   * `declaredIntent` is set when they picked a listed option rather than said
   * something, so the caregiver's own wording is not put through speech
   * classification on its way back to them.
   */
  say(
    text: string,
    occurrenceId: string | null,
    declaredIntent?: 'something_different',
  ): Promise<{ reply: string; provenance: string }> {
    return this.post('/api/assistant/turn', {
      text,
      occurrenceId,
      surface: 'tv',
      declaredIntent,
      idempotencyKey: key(`say-${text.slice(0, 24)}`, occurrenceId ?? 'none'),
    });
  }
}

function key(action: string, occurrenceId: string): string {
  // Second-resolution: a genuine second press a second later is a new action,
  // a double-fire from one press is not.
  return `tv-${occurrenceId}-${action}-${Math.floor(Date.now() / 1000)}`;
}

export function normalise(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}
