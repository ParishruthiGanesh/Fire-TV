import React from 'react';
import {
  OCCURRENCE_STATE_LABELS,
  describeDays,
  friendlyTime,
  localTimeInZone,
  type OccurrenceState,
  type OccurrenceView,
  type Routine,
} from '@alongside/shared';

export function Badge({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'teal' | 'amber' | 'rose' | 'navy';
  children: React.ReactNode;
}) {
  return <span className={`badge ${tone === 'plain' ? '' : tone}`}>{children}</span>;
}

const STATE_TONE: Record<OccurrenceState, 'plain' | 'teal' | 'amber' | 'rose' | 'navy'> = {
  scheduled: 'plain',
  in_progress: 'teal',
  postponed: 'amber',
  completed_self_report: 'teal',
  skipped: 'plain',
  completion_unconfirmed: 'amber',
};

export function StateBadge({ state }: { state: OccurrenceState }) {
  return <Badge tone={STATE_TONE[state]}>{OCCURRENCE_STATE_LABELS[state]}</Badge>;
}

export function ScheduleLine({ routine }: { routine: Routine }) {
  return (
    <span className="muted small">
      {describeDays(routine.days)} at {friendlyTime(routine.localTime)} · {routine.timezone}
    </span>
  );
}

/** The step list, with what the person has actually confirmed marked. */
export function StepList({
  occurrence,
  mediaUrl,
}: {
  occurrence: OccurrenceView;
  mediaUrl: (id: string | null) => string | null;
}) {
  return (
    <ol className="steps">
      {occurrence.routine.steps.map((step, index) => {
        const confirmed = index <= occurrence.confirmedStepIndex;
        const current = index === occurrence.currentStepIndex && occurrence.state === 'in_progress';
        const url = mediaUrl(step.mediaAssetId);
        return (
          <li key={step.id} className={[confirmed ? 'confirmed' : '', current ? 'current' : ''].join(' ').trim()}>
            <span className="num">{confirmed ? '✓' : index + 1}</span>
            <span>
              {step.body}
              {url && (
                <>
                  {' '}
                  <span className="tiny muted">(has a photo)</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TimeInZone({ iso, timezone }: { iso: string; timezone: string }) {
  return <span className="mono">{friendlyTime(localTimeInZone(iso, timezone))}</span>;
}

export function Notice({ tone, children }: { tone: 'warn' | 'bad' | 'ok'; children: React.ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

/**
 * Standing disclosure on every conversational surface.
 *
 * The hackathon permits a simulated Alexa+ experience; it would be dishonest
 * to let a viewer assume this is Alexa speaking, so the label is part of the
 * component rather than something that can be left off a screenshot.
 */
export function SimulationBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sim-banner">
      <span aria-hidden>ⓘ</span>
      <div>
        <strong>Alexa+ experience simulation.</strong> This is Alongside's own web voice client, using the
        browser's speech recognition and speech synthesis. It is not Amazon Alexa and does not run on an Echo
        device. It talks to the same backend as the Fire TV app, so everything you see here is real shared state.
        {children}
      </div>
    </div>
  );
}

export function DemoClockBar({
  offsetMs,
  now,
  timezone,
}: {
  offsetMs: number;
  now: string;
  timezone: string;
}) {
  const minutes = Math.round(offsetMs / 60000);
  return (
    <div className="demo-bar">
      <span>⏱ Demo clock is running</span>
      <span>
        The household time is <strong>{friendlyTime(localTimeInZone(now, timezone))}</strong> ({timezone})
      </span>
      <span className="tiny">
        {minutes >= 0 ? '+' : ''}
        {minutes} min from real time
      </span>
    </div>
  );
}
