import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OCCURRENCE_STATE_LABELS,
  friendlyTime,
  localTimeInZone,
  type AssistantTurnResult,
} from '@alongside/shared';
import { useAlongside } from '../state';
import { Badge, Notice, SimulationBanner } from '../components/common';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Turn {
  role: 'assistant' | 'person';
  text: string;
  intent?: string;
  provenance?: string;
}

/**
 * The connected conversational experience — an Alexa+ experience simulation.
 *
 * It is a real voice interface: the browser's speech recognition for input,
 * speech synthesis for output, push-to-talk so there is no pretence of a wake
 * word, and a typed fallback for when either is unavailable. Everything it
 * does goes through the same backend as the Fire TV app, so the television and
 * this page are never telling different stories.
 *
 * Two details matter for honesty and for the demo not falling over:
 *   - the microphone is closed while the assistant is speaking, so it cannot
 *     transcribe its own voice as the person's reply;
 *   - speaking can be interrupted at any time.
 */
export default function Voice() {
  const { api, snapshot, connection, lastSpoken, reportError } = useAlongside();
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const recognition = useRef<any>(null);
  const spokenAt = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition),
    [],
  );
  const synthSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const occurrence = snapshot?.occurrences.find((o) => o.id === snapshot.focusOccurrenceId) ?? null;
  const rate = snapshot?.profile.speechRate ?? 1;

  // ------------------------------------------------------------------ speech

  const speak = useCallback(
    (text: string) => {
      if (!synthSupported || !speechEnabled) {
        setPhase('idle');
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(0.6, Math.min(1.4, rate));
      utterance.pitch = 1;
      utterance.onstart = () => setPhase('speaking');
      utterance.onend = () => setPhase('idle');
      utterance.onerror = () => setPhase('idle');
      window.speechSynthesis.speak(utterance);
    },
    [synthSupported, speechEnabled, rate],
  );

  const stopSpeaking = useCallback(() => {
    if (synthSupported) window.speechSynthesis.cancel();
    setPhase('idle');
  }, [synthSupported]);

  // The server announces a routine coming due; say it here and show it there.
  useEffect(() => {
    if (!lastSpoken || lastSpoken.at <= spokenAt.current) return;
    spokenAt.current = lastSpoken.at;
    // The server echoes what the assistant said over the event stream, and it
    // can arrive either side of the HTTP reply. Show it once.
    setTurns((prev) => {
      if (prev.slice(-2).some((turn) => turn.role === 'assistant' && turn.text === lastSpoken.text)) return prev;
      return [...prev, { role: 'assistant', text: lastSpoken.text }];
    });
    speak(lastSpoken.text);
  }, [lastSpoken, speak]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [turns.length, turns[turns.length - 1]?.text]);

  // -------------------------------------------------------------------- turn

  const submit = useCallback(
    async (text: string) => {
      const utterance = text.trim();
      if (!utterance) return;
      setHeard('');
      setTyped('');
      setTurns((prev) => [...prev, { role: 'person', text: utterance }]);
      setPhase('thinking');
      try {
        const result: AssistantTurnResult = await api.assistantTurn({
          text: utterance,
          occurrenceId: snapshot?.focusOccurrenceId ?? null,
          surface: 'voice',
        });
        setTurns((prev) => {
          const turn = {
            role: 'assistant' as const,
            text: result.reply,
            intent: result.intent,
            provenance: result.provenance,
          };
          // If the event stream already showed this line, upgrade that bubble
          // with the provenance rather than repeating the sentence.
          const index = prev.findLastIndex((t) => t.role === 'assistant' && t.text === result.reply);
          if (index >= 0) {
            const next = [...prev];
            next[index] = turn;
            return next;
          }
          return [...prev, turn];
        });
        spokenAt.current = Date.now() + 500; // don't re-speak our own SSE echo
        speak(result.reply);
      } catch (e) {
        reportError(e);
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', text: "I couldn't reach the household just now. The buttons on the television still work." },
        ]);
        setPhase('idle');
      }
    },
    [api, snapshot?.focusOccurrenceId, speak, reportError],
  );

  // ----------------------------------------------------------------- the mic

  const startListening = useCallback(() => {
    if (!speechSupported) return;
    // Never listen while we are talking: otherwise the assistant transcribes
    // its own voice and answers itself.
    stopSpeaking();
    const Impl = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const instance = new Impl();
    instance.lang = snapshot?.profile.language ?? 'en-US';
    instance.interimResults = true;
    instance.continuous = false;
    instance.maxAlternatives = 1;
    let finalText = '';
    instance.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setHeard(finalText || interim);
    };
    instance.onerror = (event: any) => {
      setMicError(
        event.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it in the browser, or type instead.'
          : `The microphone stopped: ${event.error}. You can type instead.`,
      );
      setPhase('idle');
    };
    instance.onend = () => {
      recognition.current = null;
      setPhase((current) => (current === 'listening' ? 'idle' : current));
      if (finalText.trim()) submit(finalText);
    };
    recognition.current = instance;
    setMicError(null);
    setPhase('listening');
    instance.start();
  }, [speechSupported, stopSpeaking, snapshot?.profile.language, submit]);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
    setPhase('idle');
  }, []);

  useEffect(() => () => recognition.current?.stop(), []);

  // ------------------------------------------------------------------ render

  const quickReplies = ['Yes, please', 'What am I having?', "What's next?", 'Give me fifteen minutes', 'I already ate', 'I need help'];

  return (
    <div className="page voice-shell stack">
      <SimulationBanner>
        {' '}
        <span className="tiny">
          Push to talk — there is no wake word here, and nothing is listening until you hold the button.
        </span>
      </SimulationBanner>

      {connection !== 'live' && (
        <Notice tone={connection === 'offline' ? 'bad' : 'warn'}>
          {connection === 'offline'
            ? 'Not connected to the household. Anything you say now will not reach the television.'
            : 'Connecting to the household…'}
        </Notice>
      )}

      <section className="card" style={{ textAlign: 'center' }}>
        {occurrence ? (
          <>
            <h2>{occurrence.routine.title}</h2>
            <p className="muted small">
              {OCCURRENCE_STATE_LABELS[occurrence.state]} · due{' '}
              {friendlyTime(localTimeInZone(occurrence.dueAt, snapshot!.household.timezone))}
              {occurrence.state === 'in_progress' &&
                ` · step ${occurrence.currentStepIndex + 1} of ${occurrence.routine.steps.length} on the television`}
            </p>
          </>
        ) : (
          <>
            <h2>Nothing on right now</h2>
            <p className="muted small">The assistant will speak up when something is due.</p>
          </>
        )}

        <div className="stack" style={{ justifyItems: 'center', marginTop: 20, gap: 14 }}>
          <button
            className={`mic ${phase === 'listening' ? 'listening' : ''} ${phase === 'speaking' ? 'speaking' : ''}`}
            disabled={!speechSupported || phase === 'thinking'}
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onTouchStart={(e) => {
              e.preventDefault();
              startListening();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopListening();
            }}
            onClick={() => {
              // Keyboard and assistive technology: click toggles.
              if (phase === 'listening') stopListening();
              else if (phase === 'idle') startListening();
            }}
          >
            {phase === 'listening' ? 'Listening' : phase === 'speaking' ? 'Speaking' : phase === 'thinking' ? '…' : 'Hold to talk'}
          </button>

          <div className="state-line">
            {phase === 'listening' && <Badge tone="amber"><span className="pip" />Microphone open</Badge>}
            {phase === 'speaking' && (
              <>
                <Badge tone="navy">Speaking</Badge>
                <button className="btn ghost small" onClick={stopSpeaking}>
                  Stop
                </button>
              </>
            )}
            {phase === 'thinking' && <Badge tone="teal">Thinking</Badge>}
            {phase === 'idle' && <span className="muted small">Microphone closed</span>}
          </div>

          {heard && <p className="muted">“{heard}”</p>}
          {micError && <Notice tone="warn">{micError}</Notice>}
          {!speechSupported && (
            <Notice tone="warn">
              This browser has no speech recognition API. Chrome or Edge give the full voice experience; typing below
              works everywhere and goes through exactly the same backend.
            </Notice>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Conversation</h2>
          <label className="row tiny muted" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={speechEnabled}
              onChange={(e) => {
                setSpeechEnabled(e.target.checked);
                if (!e.target.checked) stopSpeaking();
              }}
              style={{ width: 'auto' }}
            />
            Speak replies aloud
          </label>
        </div>
        <div className="chat-scroll" ref={scroller}>
          {turns.length === 0 && (
            <p className="muted small">
              Nothing said yet. Advance the demo clock on the dashboard, or hold the button and say “start”.
            </p>
          )}
          {turns.map((turn, index) => (
            <div key={index} className={`bubble ${turn.role}`}>
              <div className="who">
                {turn.role === 'assistant' ? 'Assistant' : snapshot?.profile.preferredName ?? 'You'}
                {turn.provenance === 'unknown' && ' · not in the approved notes'}
                {turn.provenance === 'caregiver_approved' && ' · from the approved instructions'}
                {turn.provenance === 'user_reported' && ' · recorded as your own report'}
              </div>
              {turn.text}
            </div>
          ))}
        </div>

        <div className="divider" />
        <div className="composer">
          <div className="row">
            <input
              type="text"
              value={typed}
              placeholder="Or type what you would say"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit(typed);
              }}
            />
            <button className="btn" disabled={!typed.trim()} onClick={() => submit(typed)}>
              Send
            </button>
          </div>
          <div className="row">
            {quickReplies.map((reply) => (
              <button key={reply} className="btn ghost small" onClick={() => submit(reply)}>
                {reply}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
