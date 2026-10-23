import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { greetingForHour, localTimeInZone, friendlyTime, zonedParts } from '@alongside/shared/src/tv';
import { theme, scaled } from '../theme';

/**
 * The permanent frame: who this is for, what time it is, and whether the
 * television is actually connected to the household. A disconnected screen
 * says so plainly instead of quietly showing yesterday's information.
 */
export function Header({
  preferredName,
  now,
  timezone,
  connection,
  demoClock,
  textScale,
}: {
  preferredName: string;
  now: string;
  timezone: string;
  connection: 'connecting' | 'live' | 'offline';
  demoClock: boolean;
  textScale: number;
}) {
  const hour = zonedParts(now, timezone).hour;
  return (
    <View style={styles.header}>
      <Text style={[styles.greeting, { fontSize: scaled(theme.text.title, textScale) }]}>
        {greetingForHour(hour)}, {preferredName}
      </Text>
      <View style={styles.headerRight}>
        {demoClock ? (
          <View style={styles.demoPill}>
            <Text style={[styles.demoText, { fontSize: scaled(theme.text.small, textScale) }]}>Demo clock</Text>
          </View>
        ) : null}
        {connection !== 'live' ? (
          <View style={[styles.demoPill, styles.offlinePill]}>
            <Text style={[styles.demoText, { fontSize: scaled(theme.text.small, textScale) }]}>
              {connection === 'offline' ? 'Not connected' : 'Connecting'}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.clock, { fontSize: scaled(theme.text.body, textScale) }]}>
          {friendlyTime(localTimeInZone(now, timezone))}
        </Text>
      </View>
    </View>
  );
}

/** Subtitles for whatever the assistant last said, word for word. */
export function Caption({ text, textScale }: { text: string | null; textScale: number }) {
  if (!text) return null;
  return (
    <View style={styles.caption}>
      <Text style={[styles.captionLabel, { fontSize: scaled(theme.text.small, textScale) }]}>Alongside said</Text>
      <Text style={[styles.captionText, { fontSize: scaled(theme.text.label, textScale) }]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

/** Progress through the steps of one activity. */
export function StepDots({ total, current, confirmed }: { total: number; current: number; confirmed: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            index <= confirmed && styles.dotDone,
            index === current && styles.dotCurrent,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.size.gap,
  },
  greeting: { color: theme.colour.text, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  clock: { color: theme.colour.textSoft, marginLeft: 14 },
  demoPill: {
    backgroundColor: theme.colour.amber,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 10,
  },
  offlinePill: { backgroundColor: theme.colour.rose },
  demoText: { color: theme.colour.amberText, fontWeight: '700' },
  caption: {
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: theme.size.radius,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginBottom: 12,
  },
  captionLabel: { color: theme.colour.teal, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  captionText: { color: theme.colour.text },
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dotDone: { backgroundColor: theme.colour.teal },
  dotCurrent: { backgroundColor: theme.colour.amber, width: 22 },
});
