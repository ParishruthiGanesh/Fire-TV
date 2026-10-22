import React from 'react';
import { greetingForHour, localTimeInZone, zonedParts, friendlyTime, OCCURRENCE_STATE_LABELS } from '@alongside/shared';
import { useAlongside } from '../state';
import { Notice } from '../components/common';

/**
 * A browser mirror of what the Fire TV app is showing.
 *
 * This exists so a reviewer or a caregiver can see the television's state from
 * a laptop; it is explicitly *not* the Fire TV app, which is a React Native
 * build running on Fire OS (see apps/firetv). Keeping the label on the screen
 * matters more than the screen looking impressive.
 */
export default function TvPreview() {
  const { api, snapshot, lastSpoken, connection } = useAlongside();
  if (!snapshot) return <div className="page">Loading…</div>;

  const timezone = snapshot.household.timezone;
  const occurrence = snapshot.occurrences.find((o) => o.id === snapshot.focusOccurrenceId) ?? null;
  const step = occurrence?.routine.steps[occurrence.currentStepIndex] ?? null;
  const hero = api.mediaUrl(step?.mediaAssetId ?? occurrence?.routine.heroMediaAssetId ?? null);
  const hour = zonedParts(snapshot.now, timezone).hour;

  return (
    <div className="page stack">
      <Notice tone="warn">
        <strong>This is a mirror, not the Fire TV app.</strong> It renders the same backend state so you can watch the
        television from a laptop. The real Fire TV app is a React Native build for Fire OS in{' '}
        <span className="mono">apps/firetv</span>, installed with <span className="mono">adb install</span>.
      </Notice>

      <div className="tv-frame">
        <div className="screen">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              color: '#f7f3ec',
              display: 'grid',
              gridTemplateRows: 'auto 1fr auto',
              padding: '3.2% 4%',
              background: 'linear-gradient(160deg, #15253f 0%, #101d33 60%, #16253c 100%)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font)', fontSize: 'clamp(16px, 2.4vw, 34px)' }}>
                {greetingForHour(hour)}, {snapshot.profile.preferredName}
              </span>
              <span style={{ fontSize: 'clamp(13px, 1.8vw, 26px)', opacity: 0.85 }}>
                {friendlyTime(localTimeInZone(snapshot.now, timezone))}
                {snapshot.demoClock.enabled && snapshot.demoClock.offsetMs !== 0 ? ' · demo clock' : ''}
              </span>
            </div>

            {occurrence ? (
              <div style={{ display: 'grid', gridTemplateColumns: hero ? '1fr 1fr' : '1fr', gap: '3%', alignItems: 'center' }}>
                {hero && (
                  <img
                    src={hero}
                    alt=""
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 14 }}
                  />
                )}
                <div>
                  <div style={{ fontSize: 'clamp(11px, 1.3vw, 18px)', letterSpacing: '0.12em', opacity: 0.7, textTransform: 'uppercase' }}>
                    {occurrence.state === 'in_progress'
                      ? `Step ${occurrence.currentStepIndex + 1} of ${occurrence.routine.steps.length}`
                      : OCCURRENCE_STATE_LABELS[occurrence.state]}
                  </div>
                  <div style={{ fontFamily: 'var(--font)', fontSize: 'clamp(18px, 3vw, 44px)', margin: '0.3em 0' }}>
                    {occurrence.routine.title}
                  </div>
                  <div style={{ fontSize: 'clamp(13px, 1.7vw, 25px)', lineHeight: 1.45 }}>
                    {step ? step.body : occurrence.routine.greeting ?? ''}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', fontSize: 'clamp(16px, 2.4vw, 34px)', opacity: 0.8 }}>
                Nothing to do right now
              </div>
            )}

            <div style={{ display: 'flex', gap: '1.4%', flexWrap: 'wrap', alignItems: 'center' }}>
              {(occurrence
                ? occurrence.state === 'in_progress'
                  ? ['Done', 'Repeat', 'Something is different', 'I need help']
                  : ['Start', 'Show me how', 'Later', 'I need help']
                : ['Today', 'I need help']
              ).map((label, index) => (
                <span
                  key={label}
                  style={{
                    padding: '0.6em 1.1em',
                    borderRadius: 999,
                    fontSize: 'clamp(11px, 1.5vw, 22px)',
                    fontWeight: 600,
                    background: index === 0 ? '#d68f2c' : 'rgba(255,255,255,0.1)',
                    color: index === 0 ? '#2a1c05' : '#eef3f8',
                    border: index === 0 ? '3px solid #fff' : '1px solid rgba(255,255,255,0.18)',
                  }}
                >
                  {label}
                </span>
              ))}
              <span style={{ flex: 1 }} />
              {connection !== 'live' && (
                <span style={{ fontSize: 'clamp(11px, 1.4vw, 20px)', color: '#ffd9d2' }}>Not connected</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {lastSpoken && (
        <div className="card">
          <h3>Caption of what the assistant last said</h3>
          <p style={{ fontFamily: 'var(--font)', fontSize: '1.15rem', marginTop: 8 }}>“{lastSpoken.text}”</p>
        </div>
      )}
    </div>
  );
}
