import React, { useEffect, useState } from 'react';
import { friendlyTime, localTimeInZone, type MediaAsset, type RingVisitorEvent } from '@alongside/shared';
import { useAlongside } from '../state';
import { Badge, Notice } from '../components/common';

/**
 * Household setup: the profile, the timezone, pairing, the photo library, the
 * demo clock, and the two integration panels (AI provider and the optional
 * Ring simulator). Everything here is explicit about what is real and what is
 * simulated.
 */
export default function Settings() {
  const { api, snapshot, refresh, reportError, token, setToken } = useAlongside();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [ai, setAi] = useState<{ active: string; offline: boolean; lastError: string | null; fallbackCount: number } | null>(null);
  const [ringEvents, setRingEvents] = useState<RingVisitorEvent[]>([]);
  const [tokenDraft, setTokenDraft] = useState(token);

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => setAi(null));
    api.ringEvents().then((r) => setRingEvents(r.events)).catch(() => setRingEvents([]));
  }, [api, snapshot?.now]);

  if (!snapshot) return <div className="page">Loading…</div>;
  const profile = snapshot.profile;
  const demoRunning = snapshot.demoClock.enabled && snapshot.demoClock.offsetMs !== 0;

  return (
    <div className="page grid-2">
      <div className="stack">
        <section className="card">
          <h2>Who this is for</h2>
          <p className="muted small">Used in every spoken line and on the television.</p>
          <div className="stack" style={{ marginTop: 14 }}>
            <label className="field">
              Preferred name
              <input
                type="text"
                defaultValue={profile.preferredName}
                onBlur={(e) => api.updateProfile({ preferredName: e.target.value }).then(refresh).catch(reportError)}
              />
            </label>
            <label className="field">
              Full name
              <input
                type="text"
                defaultValue={profile.fullName}
                onBlur={(e) => api.updateProfile({ fullName: e.target.value }).then(refresh).catch(reportError)}
              />
            </label>
            <label className="field">
              Language for speech
              <select
                defaultValue={profile.language}
                onChange={(e) => api.updateProfile({ language: e.target.value }).then(refresh).catch(reportError)}
              >
                <option value="en-US">English (United States)</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="en-AU">English (Australia)</option>
              </select>
            </label>
            <label className="field">
              Household timezone
              <input
                type="text"
                defaultValue={snapshot.household.timezone}
                onBlur={(e) => api.updateHousehold({ timezone: e.target.value }).then(refresh).catch(reportError)}
              />
              <span className="tiny muted">
                An IANA name such as America/New_York. Routine times are stored as local wall-clock times in this zone.
              </span>
            </label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Text size on the television ({profile.textScale.toFixed(2)}×)
                <input
                  type="range"
                  min="0.85"
                  max="1.5"
                  step="0.05"
                  defaultValue={profile.textScale}
                  onChange={(e) => api.updateProfile({ textScale: Number(e.target.value) }).then(refresh).catch(reportError)}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Speech speed ({profile.speechRate.toFixed(2)}×)
                <input
                  type="range"
                  min="0.7"
                  max="1.3"
                  step="0.05"
                  defaultValue={profile.speechRate}
                  onChange={(e) => api.updateProfile({ speechRate: Number(e.target.value) }).then(refresh).catch(reportError)}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Reference photos</h2>
          <p className="muted small">
            Uploaded photos are visual aids only. Alongside never reads a dose, an appliance setting or a product
            identity out of a picture.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="btn ghost small" style={{ cursor: 'pointer' }}>
              Upload photos
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) =>
                  e.target.files && api.uploadMedia(Array.from(e.target.files)).then(refresh).catch(reportError)
                }
              />
            </label>
            <Badge>{snapshot.media.length} in the library</Badge>
          </div>
          <div className="thumbs" style={{ marginTop: 12 }}>
            {snapshot.media.map((asset: MediaAsset) => (
              <figure key={asset.id} style={{ margin: 0 }}>
                <img src={api.mediaUrl(asset.id) ?? ''} alt={asset.caption ?? asset.filename} title={asset.caption ?? ''} />
                <figcaption className="tiny muted" style={{ maxWidth: 78 }}>
                  {asset.isDemo ? 'demo' : asset.filename.slice(0, 14)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <h2>Pairing</h2>
          <p className="muted small">
            The television and the voice client each exchange this code for their own token. The code is all a device
            needs; it never sees your caregiver token.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="mono" style={{ fontSize: '1.6rem', letterSpacing: '0.18em' }}>
              {pairingCode ?? snapshot.household.pairingCode ?? '••••••'}
            </span>
            <button
              className="btn ghost small"
              onClick={() => api.rotatePairingCode().then((r) => setPairingCode(r.pairingCode)).catch(reportError)}
            >
              New code
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Demo clock</h2>
          <p className="muted small">
            Moves this household's time only, so a routine can be reached during a recording without waiting for the
            morning. Every surface shows a badge while it is running.
          </p>
          {demoRunning && (
            <Notice tone="warn">
              Running: the household time is{' '}
              <strong>{friendlyTime(localTimeInZone(snapshot.now, snapshot.household.timezone))}</strong>, which is{' '}
              {Math.round(snapshot.demoClock.offsetMs / 60000)} minutes from real time.
            </Notice>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {[5, 15, 60].map((minutes) => (
              <button
                key={minutes}
                className="btn ghost small"
                onClick={() => api.demoClock({ action: 'advance', minutes }).then(refresh).catch(reportError)}
              >
                +{minutes} min
              </button>
            ))}
            <button className="btn ghost small" onClick={() => api.demoClock({ action: 'reset' }).then(refresh).catch(reportError)}>
              Back to real time
            </button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              type="time"
              defaultValue="07:55"
              style={{ maxWidth: 140 }}
              onChange={(e) =>
                e.target.value && api.demoClock({ action: 'set', localTime: e.target.value }).then(refresh).catch(reportError)
              }
            />
            <span className="tiny muted">Jump to a local time today</span>
          </div>
        </section>

        <section className="card">
          <h2>AI provider</h2>
          {ai ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row">
                <Badge tone={ai.offline ? 'plain' : 'teal'}>{ai.active}</Badge>
                {ai.offline && <span className="tiny muted">deterministic, no credentials needed</span>}
              </div>
              {ai.fallbackCount > 0 && (
                <Notice tone="warn">
                  Fell back to the deterministic provider {ai.fallbackCount} time(s). Last reason: {ai.lastError}
                </Notice>
              )}
              <p className="tiny muted">
                Set <span className="mono">ALONGSIDE_AI_PROVIDER</span> to <span className="mono">anthropic</span> or{' '}
                <span className="mono">bedrock</span> with credentials on the server to use a hosted model. Model
                output is always schema-validated before it is stored.
              </p>
            </div>
          ) : (
            <p className="muted small">Unavailable.</p>
          )}
        </section>

        <section className="card">
          <h2>Ring — simulated doorbell</h2>
          <Notice tone="warn">
            Optional and clearly simulated. No Ring device or Ring cloud account is connected in this build; this
            button injects one local event with only the fields a doorbell press actually carries. No identity, no
            indoor activity, no video, and nothing is ever unlocked.
          </Notice>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn ghost small"
              onClick={() =>
                api
                  .simulateRing({
                    kind: 'ding',
                    deviceName: 'Front Door',
                    snapshotAssetId: snapshot.media.find((m) => m.filename.includes('front-door'))?.id ?? null,
                  })
                  .then(refresh)
                  .catch(reportError)
              }
            >
              Simulate “someone is at the door”
            </button>
          </div>
          {ringEvents.length > 0 && (
            <div className="feed" style={{ marginTop: 12 }}>
              {ringEvents.slice(0, 5).map((event) => (
                <div className="item" key={event.id}>
                  <span className="at">
                    {friendlyTime(localTimeInZone(event.receivedAt, snapshot.household.timezone))}
                  </span>
                  <span>
                    {event.kind === 'ding' ? 'Doorbell' : 'Motion'} · {event.deviceName}{' '}
                    <span className="tiny muted">({event.source})</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Caregiver token</h2>
          <p className="muted small">
            This build has one household and one caregiver. The token is the dashboard's credential — in production
            this is where a real sign-in belongs.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <input type="text" className="mono" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} />
            <button className="btn ghost small" onClick={() => setToken(tokenDraft)}>
              Use
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
