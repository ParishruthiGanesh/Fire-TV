import type {
  ActivityEvent,
  AssistantTurnResult,
  DemoClockState,
  HouseholdSnapshot,
  MediaAsset,
  Routine,
  RoutineDraft,
  RoutineOverride,
  RingVisitorEvent,
} from '@alongside/shared';

/**
 * Thin HTTP client.
 *
 * Every mutating call carries an idempotency key, because the voice client can
 * deliver the same recognition result twice and the dashboard can be
 * double-clicked, and neither should produce two help requests.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: any,
  ) {
    super(message);
  }
}

export function newIdempotencyKey(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Api {
  constructor(private token: string) {}

  setToken(token: string): void {
    this.token = token;
  }

  get bearer(): string {
    return this.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`, body);
    }
    return body as T;
  }

  health() {
    return fetch('/api/health').then((r) => r.json());
  }

  snapshot() {
    return this.request<HouseholdSnapshot>('/api/snapshot');
  }

  activity() {
    return this.request<{ events: ActivityEvent[] }>('/api/activity');
  }

  transcript(surface: 'voice' | 'tv' | 'mcp') {
    return this.request<{ turns: Array<{ role: string; text: string; createdAt: string }> }>(
      `/api/transcript/${surface}`,
    );
  }

  aiStatus() {
    return this.request<{ configured: string; active: string; offline: boolean; lastError: string | null; fallbackCount: number }>(
      '/api/ai/status',
    );
  }

  // ---------------------------------------------------------------- drafts

  drafts() {
    return this.request<{ drafts: RoutineDraft[] }>('/api/drafts');
  }

  draftMessage(input: { draftId?: string; text: string; mediaAssetIds?: string[] }) {
    return this.request<{
      draft: RoutineDraft;
      assistantMessage: string;
      followUpQuestion: string | null;
      aiProvider: string;
    }>('/api/drafts/message', {
      method: 'POST',
      body: JSON.stringify({ mediaAssetIds: [], ...input }),
    });
  }

  publishDraft(draftId: string, replaceRoutineId?: string) {
    return this.request<{ routine: Routine; snapshot: HouseholdSnapshot }>(`/api/drafts/${draftId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ replaceRoutineId }),
    });
  }

  discardDraft(draftId: string) {
    return this.request<{ draft: RoutineDraft }>(`/api/drafts/${draftId}/discard`, { method: 'POST' });
  }

  deleteVoiceNote(draftId: string) {
    return this.request<{ draft: RoutineDraft }>(`/api/drafts/${draftId}/voice-note`, { method: 'DELETE' });
  }

  reviseRoutine(routineId: string) {
    return this.request<{ draft: RoutineDraft; replaceRoutineId: string }>(`/api/routines/${routineId}/revise`, {
      method: 'POST',
    });
  }

  setRoutineActive(routineId: string, active: boolean) {
    return this.request<{ routine: Routine }>(`/api/routines/${routineId}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
  }

  // ----------------------------------------------------------------- media

  uploadMedia(files: File[], captions: string[] = []) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    for (const caption of captions) form.append('captions', caption);
    return this.request<{ assets: MediaAsset[] }>('/api/media', { method: 'POST', body: form });
  }

  deleteMedia(assetId: string) {
    return this.request<{ ok: true }>(`/api/media/${assetId}`, { method: 'DELETE' });
  }

  mediaUrl(assetId: string | null | undefined): string | null {
    return assetId ? `/media/${assetId}?token=${encodeURIComponent(this.token)}` : null;
  }

  // ----------------------------------------------------------- occurrences

  command(
    occurrenceId: string,
    action: 'start' | 'back' | 'repeat' | 'complete' | 'skip',
    options: { expectedVersion?: number; surface?: string } = {},
  ) {
    return this.request(`/api/occurrences/${occurrenceId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ surface: 'dashboard', idempotencyKey: newIdempotencyKey(), ...options }),
    });
  }

  advance(occurrenceId: string, confirmedStepIndex: number, expectedVersion?: number) {
    return this.request(`/api/occurrences/${occurrenceId}/advance`, {
      method: 'POST',
      body: JSON.stringify({
        confirmedStepIndex,
        expectedVersion,
        surface: 'dashboard',
        idempotencyKey: newIdempotencyKey(),
      }),
    });
  }

  postpone(occurrenceId: string, minutes: number, expectedVersion?: number) {
    return this.request(`/api/occurrences/${occurrenceId}/postpone`, {
      method: 'POST',
      body: JSON.stringify({ minutes, expectedVersion, surface: 'dashboard', idempotencyKey: newIdempotencyKey() }),
    });
  }

  goToStep(occurrenceId: string, stepIndex: number) {
    return this.request(`/api/occurrences/${occurrenceId}/goto`, {
      method: 'POST',
      body: JSON.stringify({ stepIndex, surface: 'dashboard', idempotencyKey: newIdempotencyKey() }),
    });
  }

  // ------------------------------------------------------------------ help

  createHelpRequest(input: { occurrenceId: string | null; message: string; surface?: 'tv' | 'voice' | 'dashboard' }) {
    return this.request('/api/help-requests', {
      method: 'POST',
      body: JSON.stringify({ surface: 'dashboard', idempotencyKey: newIdempotencyKey(), ...input }),
    });
  }

  setHelpStatus(helpId: string, status: 'acknowledge' | 'resolve') {
    return this.request(`/api/help-requests/${helpId}/${status}`, { method: 'POST' });
  }

  // ------------------------------------------------------------- assistant

  assistantTurn(input: { text: string; occurrenceId?: string | null; surface?: 'voice' | 'tv' }) {
    return this.request<AssistantTurnResult>('/api/assistant/turn', {
      method: 'POST',
      body: JSON.stringify({ surface: 'voice', idempotencyKey: newIdempotencyKey(), ...input }),
    });
  }

  // --------------------------------------------------------- household etc.

  updateProfile(patch: Record<string, unknown>) {
    return this.request('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) });
  }

  updateHousehold(patch: { name?: string; timezone?: string }) {
    return this.request('/api/household', { method: 'PATCH', body: JSON.stringify(patch) });
  }

  rotatePairingCode() {
    return this.request<{ pairingCode: string }>('/api/pairing-code/rotate', { method: 'POST' });
  }

  overrides() {
    return this.request<{ overrides: RoutineOverride[] }>('/api/overrides');
  }

  setOverride(input: { routineId: string; localDate: string; localTime: string | null; skipped: boolean; note?: string | null }) {
    return this.request('/api/overrides', { method: 'POST', body: JSON.stringify(input) });
  }

  demoClock(input: { action: 'advance' | 'set' | 'reset' | 'enable' | 'disable'; minutes?: number; localTime?: string }) {
    return this.request<{ demoClock: DemoClockState; snapshot: HouseholdSnapshot }>('/api/demo-clock', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  simulateRing(input: { kind: 'ding' | 'motion'; deviceName?: string; snapshotAssetId?: string | null }) {
    return this.request<{ event: RingVisitorEvent }>('/api/ring/simulate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  ringEvents() {
    return this.request<{ events: RingVisitorEvent[] }>('/api/ring/events');
  }

  pair(code: string, kind: 'tv' | 'voice', label?: string) {
    return fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, kind, label }),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new ApiError(response.status, body?.error ?? 'Pairing failed', body);
      return body as { token: string; household: { id: string; name: string; timezone: string } };
    });
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
