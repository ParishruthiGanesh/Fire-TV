import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  describeDays,
  friendlyTime,
  spokenTime,
  type MediaAsset,
  type RoutineDraft,
} from '@alongside/shared';
import { useAlongside } from '../state';
import { Badge, Notice } from '../components/common';

/**
 * The conversational routine builder.
 *
 * Anna describes the routine in her own words — typed, spoken, or with photos
 * attached — and Alongside proposes a structured draft. Nothing here is live:
 * a draft only becomes something the television and the assistant will act on
 * when Anna presses Publish.
 */
export default function Builder() {
  const { api, snapshot, reportError, refresh } = useAlongside();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reviseId = params.get('revise');

  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [replaceRoutineId, setReplaceRoutineId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Array<{ role: 'caregiver' | 'assistant'; text: string }>>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [library, setLibrary] = useState<MediaAsset[]>([]);
  const [recording, setRecording] = useState(false);
  const [keepRecording, setKeepRecording] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLibrary(snapshot?.media ?? []);
  }, [snapshot?.media]);

  // Starting a revision seeds a draft from the published routine.
  useEffect(() => {
    if (!reviseId || draft) return;
    api
      .reviseRoutine(reviseId)
      .then((result) => {
        setDraft(result.draft);
        setReplaceRoutineId(result.replaceRoutineId);
        setTurns(result.draft.sourceTurns.map((t) => ({ role: t.role, text: t.text })));
      })
      .catch(reportError);
  }, [reviseId, draft, api, reportError]);

  // Scroll after the new bubble has actually been laid out, not just counted,
  // or the last thing Alongside said stays half-hidden behind the composer.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [turns.length, turns[turns.length - 1]?.text, busy]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setTurns((prev) => [...prev, { role: 'caregiver', text: message }]);
    setText('');
    try {
      const result = await api.draftMessage({
        draftId: draft?.id,
        text: message,
        mediaAssetIds: selectedMedia,
      });
      setDraft(result.draft);
      setSelectedMedia([]);
      setTurns(result.draft.sourceTurns.map((t) => ({ role: t.role, text: t.text })));
    } catch (e) {
      reportError(e);
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', text: 'I could not read that just now. Try again, or write the details in yourself.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const result = await api.uploadMedia(Array.from(files));
      setLibrary((prev) => [...result.assets, ...prev]);
      setSelectedMedia((prev) => [...prev, ...result.assets.map((a) => a.id)]);
      await refresh();
    } catch (e) {
      reportError(e);
    }
  };

  const publish = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.publishDraft(draft.id, replaceRoutineId ?? undefined);
      await refresh();
      navigate('/');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = draft && draft.missing.length === 0 && draft.routine.steps.length > 0 && draft.routine.localTime;

  return (
    <div className="page grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{reviseId ? 'Change a routine by talking it through' : 'Describe the routine'}</h2>
            <p className="muted small">
              Say it the way you would say it to a person. Alongside will ask about anything it does not know rather
              than filling it in for you.
            </p>
          </div>
          {draft && <Badge tone="teal">draft</Badge>}
        </div>

        <div className="chat">
          <div className="chat-scroll" ref={scroller}>
            {turns.length === 0 && (
              <div className="bubble assistant">
                <div className="who">Alongside</div>
                Tell me about one thing in {snapshot ? `${snapshot.profile.preferredName}'s` : 'their'} day — what it is, when it
                happens, and what you'd like them to hear. You can attach a photo too.
              </div>
            )}
            {turns.map((turn, index) => (
              <div key={index} className={`bubble ${turn.role}`}>
                <div className="who">{turn.role === 'caregiver' ? 'You' : 'Alongside'}</div>
                {turn.text}
              </div>
            ))}
            {busy && (
              <div className="bubble assistant">
                <div className="who">Alongside</div>
                Reading that…
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              value={text}
              placeholder={
                turns.length === 0
                  ? 'Mum eats breakfast at eight on weekdays. Her oatmeal is in the yellow container in the fridge…'
                  : 'Make it eight thirty instead. / Only on weekdays. / Use this newer photo.'
              }
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(text);
              }}
            />
            <div className="tools">
              <button className="btn" disabled={busy || !text.trim()} onClick={() => send(text)}>
                Send
              </button>
              <label className="btn ghost small" style={{ cursor: 'pointer' }}>
                Attach photos
                <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
              </label>
              <VoiceNoteButton
                recording={recording}
                setRecording={setRecording}
                onTranscript={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))}
              />
              <label className="row tiny muted" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={keepRecording}
                  onChange={(e) => setKeepRecording(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Keep the audio recording
              </label>
              <span className="muted tiny">⌘/Ctrl + Enter sends</span>
            </div>
            {!keepRecording && recording === false && (
              <span className="tiny muted">
                Voice notes are transcribed in your browser. The transcript is kept for your review; the audio is not
                stored unless you tick the box.
              </span>
            )}
            {selectedMedia.length > 0 && (
              <div className="thumbs">
                {selectedMedia.map((assetId) => (
                  <img key={assetId} src={api.mediaUrl(assetId) ?? ''} alt="" />
                ))}
                <button className="btn ghost small" onClick={() => setSelectedMedia([])}>
                  Clear
                </button>
              </div>
            )}
            {library.length > 0 && (
              <details>
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Or pick from the {library.length} photos already uploaded
                </summary>
                <div className="thumbs" style={{ marginTop: 10 }}>
                  {library.map((asset) => (
                    <button
                      key={asset.id}
                      className={`pick ${selectedMedia.includes(asset.id) ? 'selected' : ''}`}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                      title={asset.caption ?? asset.filename}
                      onClick={() =>
                        setSelectedMedia((prev) =>
                          prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id],
                        )
                      }
                    >
                      <img src={api.mediaUrl(asset.id) ?? ''} alt={asset.caption ?? ''} />
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </section>

      <section className="stack">
        {draft ? (
          <DraftPreview draft={draft} onPublish={publish} ready={Boolean(ready)} busy={busy} />
        ) : (
          <div className="card">
            <h2>Preview</h2>
            <p className="muted small">
              As soon as you describe something, you'll see exactly what the assistant will say and what the
              television will show — before anything is published.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Draft preview.
 *
 * This is the review gate. It shows the spoken line, the TV screens, the
 * schedule, the steps and — importantly — anything still missing, so nobody
 * publishes a routine with a hole in it by accident.
 */
function DraftPreview({
  draft,
  onPublish,
  ready,
  busy,
}: {
  draft: RoutineDraft;
  onPublish: () => void;
  ready: boolean;
  busy: boolean;
}) {
  const { api, snapshot } = useAlongside();
  const routine = draft.routine;
  const name = snapshot?.profile.preferredName ?? 'they';
  const spokenOpening = useMemo(() => {
    const greeting = routine.greeting ?? `It's time for ${routine.title.toLowerCase()}.`;
    return `Good morning, ${name}. ${greeting} ${
      routine.heroMediaAssetId ? 'Would you like me to show you where it is?' : 'Would you like me to walk you through it?'
    }`;
  }, [routine.greeting, routine.title, routine.heroMediaAssetId, name]);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{routine.title || 'Untitled routine'}</h2>
            <p className="muted small">
              {routine.days.length > 0 ? describeDays(routine.days) : 'No days yet'} ·{' '}
              {routine.localTime ? friendlyTime(routine.localTime) : 'no time yet'} · {routine.timezone}
            </p>
          </div>
          <Badge>not published</Badge>
        </div>

        {draft.missing.length > 0 && (
          <Notice tone="warn">
            <strong>Still needed before this can run:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {draft.missing.map((m) => (
                <li key={m.field}>{m.question}</li>
              ))}
            </ul>
          </Notice>
        )}

        {routine.oneOff && (
          <Notice tone="ok">
            One-day change: on <strong>{routine.oneOff.localDate}</strong> this will run at{' '}
            <strong>{friendlyTime(routine.oneOff.localTime)}</strong>. The recurring time stays at{' '}
            {routine.localTime ? friendlyTime(routine.localTime) : '—'}.
          </Notice>
        )}

        <div className="divider" />

        <h3>What the assistant will say</h3>
        <p className="muted small" style={{ marginBottom: 6 }}>
          when the routine comes due
        </p>
        <blockquote
          style={{
            margin: 0,
            padding: '12px 15px',
            background: 'var(--teal-soft)',
            borderRadius: 12,
            fontFamily: 'var(--font)',
            fontSize: '1.05rem',
          }}
        >
          “{spokenOpening}”
        </blockquote>
        {routine.localTime && (
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Spoken as “{spokenTime(routine.localTime)}”.
          </p>
        )}

        <div className="divider" />

        <h3>What the television will show</h3>
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          {routine.steps.length === 0 && <p className="muted small">No steps yet.</p>}
          {routine.steps.map((step, index) => {
            const url = api.mediaUrl(step.mediaAssetId ?? routine.heroMediaAssetId);
            return (
              <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span className="num" style={{ minWidth: 24 }}>
                  <Badge tone="navy">{index + 1}</Badge>
                </span>
                {url && (
                  <img
                    src={url}
                    alt=""
                    style={{ width: 120, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <strong className="small">{step.title}</strong>
                  <p className="small">{step.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        {routine.alternatives.length > 0 && (
          <>
            <div className="divider" />
            <h3>If something is different</h3>
            <p className="muted small">Alongside may only offer answers you have approved here.</p>
            <ul style={{ paddingLeft: 18, margin: '8px 0 0' }}>
              {routine.alternatives.map((alt, index) => (
                <li key={index} className="small">
                  <em>{alt.situation}</em> → “{alt.response}”
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="divider" />
        <div className="row">
          <span className="badge">Follow-up after “later”: {routine.followUpMinutes} min</span>
          {routine.helpPolicy && <span className="badge amber">Help: {routine.helpPolicy}</span>}
        </div>

        <div className="divider" />
        <div className="row">
          <button className="btn big" disabled={!ready || busy} onClick={onPublish}>
            Publish this routine
          </button>
          {!ready && <span className="muted small">Answer the question above first.</span>}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Nothing runs until you publish. Published by {draft.aiProvider === 'seed' ? 'seed data' : 'you'}; drafted with
          the <span className="mono">{draft.aiProvider}</span> provider.
        </p>
      </div>

      <div className="card">
        <h3>Your original words</h3>
        <p className="muted small">Kept so you can check what Alongside made of them.</p>
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {draft.sourceTurns
            .filter((t) => t.role === 'caregiver')
            .map((turn, index) => (
              <p key={index} className="small" style={{ borderLeft: '3px solid var(--line)', paddingLeft: 10 }}>
                {turn.text}
              </p>
            ))}
        </div>
        {draft.voiceNoteAssetId && (
          <div className="row" style={{ marginTop: 12 }}>
            <audio controls src={api.mediaUrl(draft.voiceNoteAssetId) ?? undefined} />
            <button className="btn danger small" onClick={() => api.deleteVoiceNote(draft.id)}>
              Delete the recording
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Dictation for the caregiver.
 *
 * Uses the browser's own speech recognition, so no audio leaves the machine
 * unless the caregiver chooses to keep the recording.
 */
function VoiceNoteButton({
  recording,
  setRecording,
  onTranscript,
}: {
  recording: boolean;
  setRecording: (value: boolean) => void;
  onTranscript: (text: string) => void;
}) {
  const recognition = useRef<any>(null);
  const supported = typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

  const toggle = () => {
    if (!supported) return;
    if (recording) {
      recognition.current?.stop();
      setRecording(false);
      return;
    }
    const Impl = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const instance = new Impl();
    instance.lang = 'en-US';
    instance.interimResults = false;
    instance.continuous = true;
    instance.onresult = (event: any) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) text += `${event.results[i][0].transcript} `;
      }
      if (text.trim()) onTranscript(text.trim());
    };
    instance.onend = () => setRecording(false);
    instance.onerror = () => setRecording(false);
    recognition.current = instance;
    instance.start();
    setRecording(true);
  };

  if (!supported) {
    return (
      <span className="tiny muted" title="This browser has no speech recognition API">
        Dictation needs Chrome or Edge
      </span>
    );
  }
  return (
    <button className={`btn small ${recording ? 'amber' : 'ghost'}`} onClick={toggle}>
      {recording ? '● Recording — tap to stop' : '🎙 Record a voice note'}
    </button>
  );
}
