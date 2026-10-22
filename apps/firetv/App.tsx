import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  OCCURRENCE_STATE_LABELS,
  friendlyTime,
  localDateInZone,
  localTimeInZone,
  type HouseholdSnapshot,
  type OccurrenceView,
  type ServerEvent,
} from '@alongside/shared/src/tv';
import { theme, scaled } from './src/theme';
import { TvButton, TvButtonRow } from './src/components/TvButton';
import { Caption, Header, StepDots } from './src/components/Chrome';
import { TvClient, type Connection } from './src/client';
import { useRemote } from './src/remote';
import Setup from './src/screens/Setup';

type ScreenName = 'home' | 'steps' | 'different' | 'help' | 'upcoming';

interface Action {
  label: string;
  hint?: string;
  tone?: 'normal' | 'primary' | 'quiet';
  run: () => void;
}

/**
 * Alongside on Fire TV.
 *
 * One activity, one step, a handful of large choices, and never more than one
 * decision on screen at a time. Everything shown here comes from the shared
 * backend; the television decides nothing on its own, so what Mary sees and
 * what Anna sees cannot disagree.
 */
export default function App() {
  const [settings, setSettings] = useState<{ baseUrl: string; token: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>({ status: 'connecting', via: null });
  const [screen, setScreen] = useState<ScreenName>('home');
  const [focus, setFocus] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [photoFirst, setPhotoFirst] = useState(false);
  const [paused, setPaused] = useState(false);
  const client = useRef<TvClient | null>(null);

  // ------------------------------------------------------------- connection

  useEffect(() => {
    TvClient.loadSettings().then(({ baseUrl, token }) => {
      if (baseUrl && token) setSettings({ baseUrl, token });
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!settings) return undefined;
    const instance = new TvClient(
      settings.baseUrl,
      settings.token,
      setSnapshot,
      (event: ServerEvent) => {
        if (event.type === 'speak') setCaption(event.text);
        if (event.type === 'occurrence_due') {
          // A reminder pulls the television back to the activity itself.
          setScreen('home');
          setFocus(0);
          setPhotoFirst(false);
        }
        if (event.type === 'ring_event') {
          setMessage(`Someone is at the ${event.event.deviceName}. (Simulated doorbell event.)`);
        }
      },
      setConnection,
    );
    client.current = instance;
    instance.start();
    return () => {
      instance.stop();
      client.current = null;
    };
  }, [settings]);

  const occurrence: OccurrenceView | null = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.occurrences.find((o) => o.id === snapshot.focusOccurrenceId) ?? null;
  }, [snapshot]);

  // The step screen follows the backend: if the voice client advances a step,
  // the television advances with it.
  useEffect(() => {
    if (occurrence?.state === 'in_progress' && screen === 'home') setScreen('steps');
    if (occurrence && occurrence.state !== 'in_progress' && screen === 'steps') setScreen('home');
  }, [occurrence?.state, occurrence?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- actions

  const run = useCallback(
    async (work: () => Promise<unknown>, note?: string) => {
      try {
        if (note) setMessage(note);
        await work();
        setMessage(null);
      } catch (error: any) {
        setMessage(error?.message ?? 'That did not go through. Please try again.');
      }
    },
    [],
  );

  const actions: Action[] = useMemo(() => {
    const api = client.current;
    if (!api || !snapshot) return [];

    if (screen === 'help') {
      return [
        {
          label: 'Yes, ask for help',
          tone: 'primary',
          run: () =>
            run(async () => {
              await api.requestHelp(occurrence?.id ?? null, 'I need a hand, please.');
              setMessage(
                `${caregiverName(snapshot)} will see this on her dashboard. Nothing has been sent as a message or a call.`,
              );
            }),
        },
        { label: 'Not now', run: () => back() },
      ];
    }

    if (screen === 'different') {
      const alternatives = occurrence?.routine.alternatives ?? [];
      return [
        ...alternatives.map((alternative) => ({
          label: shorten(alternative.situation),
          hint: 'tell Alongside',
          run: () =>
            run(async () => {
              const reply = await api.say(alternative.situation, occurrence?.id ?? null);
              setMessage(reply.reply);
            }),
        })),
        {
          label: 'Something else',
          run: () =>
            run(async () => {
              const reply = await api.say('Something is different and I am not sure what to do', occurrence?.id ?? null);
              setMessage(reply.reply);
            }),
        },
        { label: 'I need help', run: () => go('help') },
        { label: 'Back', run: () => back() },
      ];
    }

    if (screen === 'upcoming') {
      return [{ label: 'Back', run: () => back() }];
    }

    if (screen === 'steps' && occurrence) {
      const last = occurrence.routine.steps.length - 1;
      return [
        {
          label: occurrence.currentStepIndex >= last ? 'I have finished' : 'Done, what is next',
          tone: 'primary',
          hint: occurrence.currentStepIndex >= last ? 'mark it complete' : 'confirm this step',
          run: () => run(() => api.advance(occurrence.id, occurrence.currentStepIndex)),
        },
        { label: 'Repeat', hint: 'read it again', run: () => run(() => api.command(occurrence.id, 'repeat')) },
        {
          label: 'Go back',
          hint: 'previous step',
          run: () => run(() => api.command(occurrence.id, 'back')),
        },
        { label: 'Something is different', run: () => go('different') },
        {
          label: 'Finish later',
          hint: `remind me in ${occurrence.routine.followUpMinutes} minutes`,
          run: () => run(() => api.postpone(occurrence.id, occurrence.routine.followUpMinutes)),
        },
        { label: 'I need help', run: () => go('help') },
      ];
    }

    // Home
    if (occurrence && (occurrence.state === 'scheduled' || occurrence.state === 'postponed' || occurrence.state === 'completion_unconfirmed')) {
      return [
        {
          label: occurrence.confirmedStepIndex >= 0 ? 'Continue' : 'Start',
          tone: 'primary',
          hint:
            occurrence.confirmedStepIndex >= 0
              ? `pick up at step ${occurrence.confirmedStepIndex + 2}`
              : `${occurrence.routine.steps.length} steps`,
          run: () =>
            run(async () => {
              setPhotoFirst(false);
              await api.command(occurrence.id, 'start');
            }),
        },
        {
          label: 'Show me how',
          hint: 'with the photo',
          run: () =>
            run(async () => {
              setPhotoFirst(true);
              await api.command(occurrence.id, 'start');
            }),
        },
        {
          label: 'Later',
          hint: `${occurrence.routine.followUpMinutes} minutes`,
          run: () => run(() => api.postpone(occurrence.id, occurrence.routine.followUpMinutes)),
        },
        { label: 'Something is different', run: () => go('different') },
        { label: 'I need help', run: () => go('help') },
      ];
    }

    return [
      { label: 'What is coming up', tone: 'primary', run: () => go('upcoming') },
      { label: 'I need help', run: () => go('help') },
    ];
  }, [screen, occurrence, snapshot, run]);

  const go = (next: ScreenName) => {
    setScreen(next);
    setFocus(0);
    setMessage(null);
  };

  const back = useCallback(() => {
    setMessage(null);
    if (screen === 'home') return false;
    if (screen === 'steps') {
      setScreen('home');
      setFocus(0);
      return true;
    }
    setScreen(occurrence?.state === 'in_progress' ? 'steps' : 'home');
    setFocus(0);
    return true;
  }, [screen, occurrence?.state]);

  // Back behaves the way it does everywhere else on Fire TV: one step back,
  // and from the first screen it leaves the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => back());
    return () => subscription.remove();
  }, [back]);

  useRemote((key) => {
    if (!settings) return;
    if (key === 'left' || key === 'up') setFocus((f) => (f - 1 + actions.length) % Math.max(actions.length, 1));
    else if (key === 'right' || key === 'down') setFocus((f) => (f + 1) % Math.max(actions.length, 1));
    else if (key === 'select') actions[focus]?.run();
    else if (key === 'playpause') setPaused((p) => !p);
    else if (key === 'menu') go('upcoming');
  });

  useEffect(() => {
    if (focus >= actions.length) setFocus(0);
  }, [actions.length, focus]);

  // ----------------------------------------------------------------- render

  if (!loaded) {
    return (
      <View style={styles.root}>
        <StatusBar hidden />
      </View>
    );
  }

  if (!settings) {
    return (
      <View style={styles.root}>
        <StatusBar hidden />
        <Setup
          initialBaseUrl=""
          onPaired={(baseUrl, token) => {
            setSettings({ baseUrl, token });
            setScreen('home');
            setFocus(0);
          }}
        />
      </View>
    );
  }

  const textScale = snapshot?.profile.textScale ?? 1;
  const timezone = snapshot?.household.timezone ?? 'UTC';
  const step = occurrence?.routine.steps[occurrence.currentStepIndex] ?? null;
  const photo = client.current?.mediaUrl(step?.mediaAssetId ?? occurrence?.routine.heroMediaAssetId ?? null) ?? null;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={styles.page}>
        <Header
          preferredName={snapshot?.profile.preferredName ?? 'there'}
          now={snapshot?.now ?? new Date().toISOString()}
          timezone={timezone}
          connection={connection.status}
          demoClock={Boolean(snapshot?.demoClock.enabled && snapshot.demoClock.offsetMs !== 0)}
          textScale={textScale}
        />

        <View style={styles.body}>
          {!snapshot ? (
            <Text style={[styles.title, { fontSize: scaled(theme.text.title, textScale) }]}>
              {connection.status === 'offline' ? 'Not connected to the household' : 'Getting today ready…'}
            </Text>
          ) : screen === 'upcoming' ? (
            <Upcoming snapshot={snapshot} textScale={textScale} timezone={timezone} />
          ) : screen === 'help' ? (
            <Simple
              title="Would you like me to ask for help?"
              body={`I'll put a note on ${caregiverName(snapshot)}'s dashboard with what you're doing right now.`}
              textScale={textScale}
            />
          ) : screen === 'different' ? (
            <Simple
              title="What is different?"
              body="Choose the closest one. I will only tell you things your family has written down."
              textScale={textScale}
            />
          ) : occurrence ? (
            <Activity
              occurrence={occurrence}
              step={step}
              photo={photo}
              photoFirst={photoFirst || screen === 'home'}
              showSteps={screen === 'steps'}
              textScale={textScale}
              timezone={timezone}
              paused={paused}
            />
          ) : (
            <Simple
              title="Nothing to do right now"
              body="I'll let you know when something is coming up."
              textScale={textScale}
            />
          )}
        </View>

        {message ? (
          <View style={styles.message}>
            <Text style={[styles.messageText, { fontSize: scaled(theme.text.label, textScale) }]}>{message}</Text>
          </View>
        ) : null}

        <Caption text={caption} textScale={textScale} />

        <TvButtonRow>
          {actions.map((action, index) => (
            <TvButton
              key={`${action.label}-${index}`}
              label={action.label}
              hint={action.hint}
              tone={action.tone}
              focused={index === focus}
              textScale={textScale}
              onPress={action.run}
            />
          ))}
        </TvButtonRow>
      </View>
    </View>
  );
}

/** The activity itself: one photo, one instruction, nothing else competing. */
function Activity({
  occurrence,
  step,
  photo,
  photoFirst,
  showSteps,
  textScale,
  timezone,
  paused,
}: {
  occurrence: OccurrenceView;
  step: { title: string; body: string } | null;
  photo: string | null;
  photoFirst: boolean;
  showSteps: boolean;
  textScale: number;
  timezone: string;
  paused: boolean;
}) {
  const total = occurrence.routine.steps.length;
  return (
    <View style={styles.activity}>
      {photo ? (
        <Image source={{ uri: photo }} style={[styles.photo, photoFirst && styles.photoLarge]} resizeMode="cover" />
      ) : null}
      <View style={styles.activityText}>
        <Text style={[styles.eyebrow, { fontSize: scaled(theme.text.small, textScale) }]}>
          {showSteps
            ? `Step ${occurrence.currentStepIndex + 1} of ${total}`
            : `${OCCURRENCE_STATE_LABELS[occurrence.state]} · ${friendlyTime(localTimeInZone(occurrence.dueAt, timezone))}`}
          {paused ? ' · paused' : ''}
        </Text>
        <Text style={[styles.title, { fontSize: scaled(theme.text.hero, textScale) }]} numberOfLines={2}>
          {occurrence.routine.title}
        </Text>
        {showSteps ? <StepDots total={total} current={occurrence.currentStepIndex} confirmed={occurrence.confirmedStepIndex} /> : null}
        <Text style={[styles.instruction, { fontSize: scaled(theme.text.body, textScale) }]} numberOfLines={5}>
          {showSteps && step
            ? step.body
            : occurrence.routine.greeting ?? `It's time for ${occurrence.routine.title.toLowerCase()}.`}
        </Text>
        {!showSteps && occurrence.confirmedStepIndex >= 0 ? (
          <Text style={[styles.resume, { fontSize: scaled(theme.text.label, textScale) }]}>
            You were on step {occurrence.confirmedStepIndex + 2}. Would you like to continue?
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Upcoming({
  snapshot,
  textScale,
  timezone,
}: {
  snapshot: HouseholdSnapshot;
  textScale: number;
  timezone: string;
}) {
  const today = localDateInZone(snapshot.now, timezone);
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.title, { fontSize: scaled(theme.text.title, textScale), marginBottom: 12 }]}>
        Coming up
      </Text>
      <ScrollView>
        {snapshot.occurrences.slice(0, 8).map((occurrence) => (
          <View key={occurrence.id} style={styles.upcomingRow}>
            <Text style={[styles.upcomingTime, { fontSize: scaled(theme.text.body, textScale) }]}>
              {friendlyTime(localTimeInZone(occurrence.dueAt, timezone))}
            </Text>
            <Text style={[styles.upcomingTitle, { fontSize: scaled(theme.text.body, textScale) }]}>
              {occurrence.routine.title}
              <Text style={styles.upcomingWhen}>
                {occurrence.localDate === today ? '  today' : `  ${occurrence.localDate}`}
                {`  ·  ${OCCURRENCE_STATE_LABELS[occurrence.state]}`}
              </Text>
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Simple({ title, body, textScale }: { title: string; body: string; textScale: number }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Text style={[styles.title, { fontSize: scaled(theme.text.hero, textScale) }]}>{title}</Text>
      <Text style={[styles.instruction, { fontSize: scaled(theme.text.body, textScale), marginTop: 12 }]}>{body}</Text>
    </View>
  );
}

function caregiverName(snapshot: HouseholdSnapshot): string {
  return snapshot.caregiverName || 'your family';
}

function shorten(text: string): string {
  const trimmed = text.trim();
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capped.length > 42 ? `${capped.slice(0, 40)}…` : capped;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colour.background },
  page: { flex: 1, paddingHorizontal: theme.size.safe, paddingVertical: theme.size.safe * 0.7 },
  body: { flex: 1, justifyContent: 'center' },
  activity: { flexDirection: 'row', alignItems: 'center' },
  photo: {
    width: 360,
    height: 202,
    borderRadius: theme.size.radius,
    marginRight: 28,
    backgroundColor: theme.colour.panel,
  },
  photoLarge: { width: 440, height: 248 },
  activityText: { flex: 1 },
  eyebrow: { color: theme.colour.teal, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 6 },
  title: { color: theme.colour.text, fontWeight: '700' },
  instruction: { color: theme.colour.text, lineHeight: 40, marginTop: 8 },
  resume: { color: theme.colour.amber, marginTop: 10 },
  message: {
    backgroundColor: 'rgba(214,143,44,0.18)',
    borderRadius: theme.size.radius,
    borderWidth: 2,
    borderColor: theme.colour.amber,
    padding: 14,
    marginBottom: 12,
  },
  messageText: { color: theme.colour.text },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  upcomingTime: { color: theme.colour.teal, width: 150 },
  upcomingTitle: { color: theme.colour.text, flex: 1 },
  upcomingWhen: { color: theme.colour.textSoft, fontSize: theme.text.small },
});
