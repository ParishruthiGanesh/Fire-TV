import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addLocalDays,
  describeDays,
  friendlyTime,
  localDateInZone,
  localTimeInZone,
  type ActivityEvent,
  type HelpRequest,
  type OccurrenceView,
} from '@alongside/shared';
import { useAlongside } from '../state';
import { Badge, Notice, ScheduleLine, StateBadge, StepList } from '../components/common';

/**
 * The caregiver's overview.
 *
 * Ordered the way a worried family member actually reads a screen: anything
 * asking for them first, then what is happening right now, then today, then
 * the quieter record of what has been reported.
 */
export default function Dashboard() {
  const { api, snapshot, reportError } = useAlongside();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    api
      .activity()
      .then((r) => setActivity(r.events))
      .catch(() => setActivity([]));
  }, [api, snapshot?.occurrences.map((o) => o.version).join(',')]);

  if (!snapshot) {
    return (
      <div className="page">
        <div className="card">Loading the household…</div>
      </div>
    );
  }

  const timezone = snapshot.household.timezone;
  const today = localDateInZone(snapshot.now, timezone);
  const todays = snapshot.occurrences.filter((o) => o.localDate === today);
  const upcoming = snapshot.occurrences.filter((o) => o.localDate > today);
  const openHelp = snapshot.helpRequests.filter((h) => h.status !== 'resolved');
  const focus = snapshot.occurrences.find((o) => o.id === snapshot.focusOccurrenceId) ?? null;

  return (
    <div className="page stack">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{snapshot.profile.preferredName}'s day</h1>
          <p className="muted small">
            {snapshot.household.name} · {timezone} · household time{' '}
            {friendlyTime(localTimeInZone(snapshot.now, timezone))}
          </p>
        </div>
        <div className="row">
          <Link className="btn" to="/builder">
            Add a routine
          </Link>
        </div>
      </header>

      {openHelp.length > 0 && (
        <HelpPanel
          requests={openHelp}
          onAcknowledge={(id) => api.setHelpStatus(id, 'acknowledge').catch(reportError)}
          onResolve={(id) => api.setHelpStatus(id, 'resolve').catch(reportError)}
        />
      )}

      <div className="grid-2">
        <div className="stack">
          {focus && <FocusCard occurrence={focus} />}

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Today</h2>
                <p className="muted small">What {snapshot.profile.preferredName} has reported, and what is still to come.</p>
              </div>
              <Badge>{todays.length} activities</Badge>
            </div>
            {todays.length === 0 ? (
              <p className="muted">
                Nothing is scheduled for today. <Link to="/builder">Describe a routine</Link> and publish it when it
                reads right.
              </p>
            ) : (
              <div className="grid-cards">
                {todays.map((occurrence) => (
                  <OccurrenceCard key={occurrence.id} occurrence={occurrence} />
                ))}
              </div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>Coming up</h2>
                <Badge>next {Math.min(2, upcoming.length)} days</Badge>
              </div>
              <div className="feed">
                {upcoming.map((occurrence) => (
                  <div className="item" key={occurrence.id}>
                    <span className="at">{friendlyTime(localTimeInZone(occurrence.dueAt, timezone))}</span>
                    <span>
                      <strong>{occurrence.routine.title}</strong>{' '}
                      <span className="muted small">
                        · {occurrence.localDate === addLocalDays(today, 1) ? 'tomorrow' : occurrence.localDate}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <RoutinesCard />
          <section className="card">
            <div className="card-head">
              <h2>Activity</h2>
              <span className="muted tiny">Newest first</span>
            </div>
            <div className="feed">
              {activity.slice(0, 18).map((event) => {
                const day = localDateInZone(event.createdAt, timezone);
                return (
                  <div className="item" key={event.id}>
                    <span className="at">{friendlyTime(localTimeInZone(event.createdAt, timezone))}</span>
                    <span>
                      {event.summary}
                      <br />
                      <span className="muted tiny">
                        {day !== today ? `${dayLabel(day, today)} · ` : ''}
                        {originLabel(event)}
                      </span>
                    </span>
                  </div>
                );
              })}
              {activity.length === 0 && <p className="muted small">Nothing has happened yet today.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Where an activity entry came from, in words a caregiver would use. */
function originLabel(event: ActivityEvent): string {
  if (event.type.startsWith('ring_')) return 'from the doorbell simulator';
  if (event.surface === 'system') return 'scheduled by Alongside';
  return `from the ${surfaceLabel(event.surface)}`;
}

/** "yesterday", or the date, for anything not from today. */
function dayLabel(day: string, today: string): string {
  if (day === addLocalDays(today, -1)) return 'yesterday';
  if (day === addLocalDays(today, 1)) return 'tomorrow';
  return day;
}

function surfaceLabel(surface: string): string {
  switch (surface) {
    case 'tv':
      return 'television';
    case 'voice':
      return 'voice client';
    case 'mcp':
      return 'MCP client';
    case 'dashboard':
      return 'dashboard';
    default:
      return surface;
  }
}

function FocusCard({ occurrence }: { occurrence: OccurrenceView }) {
  const { api, snapshot, reportError } = useAlongside();
  const timezone = snapshot!.household.timezone;
  const step = occurrence.routine.steps[occurrence.currentStepIndex];
  const heroUrl = api.mediaUrl(step?.mediaAssetId ?? occurrence.routine.heroMediaAssetId);

  return (
    <section className={`card ${occurrence.due ? '' : ''}`}>
      <div className="card-head">
        <div>
          <h2>{occurrence.state === 'in_progress' ? 'In progress now' : 'Next up'}</h2>
          <p className="muted small">
            {occurrence.routine.title} · due {friendlyTime(localTimeInZone(occurrence.dueAt, timezone))}
          </p>
        </div>
        <StateBadge state={occurrence.state} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        {heroUrl && (
          <img
            src={heroUrl}
            alt=""
            style={{ width: 220, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)' }}
          />
        )}
        <div className="stack" style={{ flex: 1, minWidth: 240 }}>
          {occurrence.state === 'in_progress' && step ? (
            <p>
              <span className="muted small">
                Step {occurrence.currentStepIndex + 1} of {occurrence.routine.steps.length} on screen
              </span>
              <br />
              {step.body}
            </p>
          ) : (
            <p className="muted">{occurrence.routine.greeting ?? `It's time for ${occurrence.routine.title.toLowerCase()}.`}</p>
          )}
          <p className="tiny muted">
            Last step {snapshot!.profile.preferredName} confirmed:{' '}
            {occurrence.confirmedStepIndex >= 0 ? `step ${occurrence.confirmedStepIndex + 1}` : 'none yet'}. Showing a
            step is not the same as finishing it.
          </p>
          <div className="row">
            <button className="btn small ghost" onClick={() => api.postpone(occurrence.id, 15).catch(reportError)}>
              Postpone 15 min
            </button>
            <button className="btn small ghost" onClick={() => api.command(occurrence.id, 'skip').catch(reportError)}>
              Skip today
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function OccurrenceCard({ occurrence }: { occurrence: OccurrenceView }) {
  const { api, snapshot } = useAlongside();
  const timezone = snapshot!.household.timezone;
  const [open, setOpen] = useState(false);
  const thumb = api.mediaUrl(occurrence.routine.heroMediaAssetId);
  const done = occurrence.state === 'completed_self_report' || occurrence.state === 'skipped';

  return (
    <article className={`occurrence ${occurrence.due && !done ? 'due' : ''} ${done ? 'done' : ''}`}>
      {thumb && <img className="thumb" src={thumb} alt="" />}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="when">{friendlyTime(localTimeInZone(occurrence.dueAt, timezone))}</span>
        <StateBadge state={occurrence.state} />
      </div>
      <h3>{occurrence.routine.title}</h3>
      <ScheduleLine routine={occurrence.routine} />
      {occurrence.postponeCount > 0 && (
        <span className="tiny muted">
          Postponed {occurrence.postponeCount} time{occurrence.postponeCount > 1 ? 's' : ''} today — the recurring
          routine is unchanged.
        </span>
      )}
      <button className="btn small ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide steps' : `Show ${occurrence.routine.steps.length} steps`}
      </button>
      {open && <StepList occurrence={occurrence} mediaUrl={(id) => api.mediaUrl(id)} />}
      {occurrence.state === 'completion_unconfirmed' && (
        <p className="tiny muted">
          Alongside asked and no answer came back. That is all this means — it is not a sign that anything is wrong.
        </p>
      )}
    </article>
  );
}

function HelpPanel({
  requests,
  onAcknowledge,
  onResolve,
}: {
  requests: HelpRequest[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const { snapshot } = useAlongside();
  const timezone = snapshot!.household.timezone;
  return (
    <section className="card" style={{ borderColor: 'var(--amber)', background: '#fffdf8' }}>
      <div className="card-head">
        <div>
          <h2>Help requested</h2>
          <p className="muted small">
            Shown here the moment it is raised. Alongside has not sent a message, an email or a call.
          </p>
        </div>
        <Badge tone="amber">
          <span className="pip" />
          {requests.length} open
        </Badge>
      </div>
      <div className="stack">
        {requests.map((request) => (
          <div key={request.id} className="occurrence" style={{ borderColor: 'var(--amber)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>“{request.message}”</strong>
              <span className="muted small">{friendlyTime(localTimeInZone(request.createdAt, timezone))}</span>
            </div>
            <span className="muted small">
              {request.routineTitle ? `During ${request.routineTitle}` : 'Not during an activity'}
              {request.stepIndex !== null && request.stepTitle ? ` · step ${request.stepIndex + 1}: ${request.stepTitle}` : ''}
              {` · raised from the ${surfaceLabel(request.raisedFrom)}`}
            </span>
            <div className="row">
              {request.status === 'open' ? (
                <button className="btn amber small" onClick={() => onAcknowledge(request.id)}>
                  Acknowledge
                </button>
              ) : (
                <Badge tone="teal">Acknowledged</Badge>
              )}
              <button className="btn ghost small" onClick={() => onResolve(request.id)}>
                Mark resolved
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoutinesCard() {
  const { api, snapshot, reportError, refresh } = useAlongside();
  const routines = snapshot!.routines;
  const timezone = snapshot!.household.timezone;
  const [editing, setEditing] = useState<string | null>(null);
  const tomorrow = useMemo(() => addLocalDays(localDateInZone(snapshot!.now, timezone), 1), [snapshot, timezone]);
  const [time, setTime] = useState('09:30');

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Published routines</h2>
          <p className="muted small">Only published routines run. Drafts never do.</p>
        </div>
      </div>
      <div className="stack">
        {routines.length === 0 && <p className="muted small">Nothing published yet.</p>}
        {routines.map((routine) => (
          <div key={routine.id} className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{routine.title}</strong>
              <Badge tone="teal">v{routine.version}</Badge>
            </div>
            <span className="muted small">
              {describeDays(routine.days)} at {friendlyTime(routine.localTime)}
            </span>
            <div className="row">
              <Link className="btn ghost small" to={`/builder?revise=${routine.id}`}>
                Change by conversation
              </Link>
              <button className="btn ghost small" onClick={() => setEditing(editing === routine.id ? null : routine.id)}>
                Just for tomorrow
              </button>
            </div>
            {editing === routine.id && (
              <div className="stack" style={{ gap: 8, background: 'var(--cream-2)', padding: 12, borderRadius: 12 }}>
                <label className="field">
                  New time for {tomorrow} only
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </label>
                <div className="row">
                  <button
                    className="btn small"
                    onClick={async () => {
                      try {
                        await api.setOverride({
                          routineId: routine.id,
                          localDate: tomorrow,
                          localTime: time,
                          skipped: false,
                          note: 'One-day change from the dashboard',
                        });
                        setEditing(null);
                        await refresh();
                      } catch (e) {
                        reportError(e);
                      }
                    }}
                  >
                    Save for tomorrow only
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      try {
                        await api.setOverride({
                          routineId: routine.id,
                          localDate: tomorrow,
                          localTime: null,
                          skipped: true,
                          note: 'Skipped for one day',
                        });
                        setEditing(null);
                        await refresh();
                      } catch (e) {
                        reportError(e);
                      }
                    }}
                  >
                    Skip tomorrow
                  </button>
                </div>
                <span className="tiny muted">The recurring schedule stays as it is.</span>
              </div>
            )}
            <div className="divider" />
          </div>
        ))}
      </div>
    </section>
  );
}
