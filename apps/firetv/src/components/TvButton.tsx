import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme, scaled } from '../theme';

/**
 * A large, obviously-focusable choice.
 *
 * Focus is driven by props rather than by Android's focus system, so the
 * highlight is always exactly where the screen says it is. The focused state
 * is carried by three signals at once — fill, a white ring and a size change —
 * because one of them alone is easy to miss on a television across a room.
 */
export function TvButton({
  label,
  hint,
  focused,
  tone = 'normal',
  textScale = 1,
  onPress,
}: {
  label: string;
  hint?: string;
  focused: boolean;
  tone?: 'normal' | 'primary' | 'quiet';
  textScale?: number;
  onPress?: () => void;
}) {
  const background = focused
    ? theme.colour.amber
    : tone === 'primary'
      ? theme.colour.tealDeep
      : 'rgba(255,255,255,0.09)';
  const colour = focused ? theme.colour.amberText : theme.colour.text;

  return (
    <Pressable
      // Focus is managed in JavaScript; keep Android's focus system out of it.
      focusable={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      style={[
        styles.button,
        { backgroundColor: background, borderColor: focused ? theme.colour.focusRing : 'rgba(255,255,255,0.16)' },
        focused && styles.focused,
      ]}
    >
      <Text style={[styles.label, { color: colour, fontSize: scaled(theme.text.label, textScale) }]}>{label}</Text>
      {hint ? (
        <Text style={[styles.hint, { color: colour, fontSize: scaled(theme.text.small, textScale) }]}>{hint}</Text>
      ) : null}
    </Pressable>
  );
}

/** A row of choices, laid out so nothing is ever off the edge of the screen. */
export function TvButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 999,
    borderWidth: 3,
    marginRight: theme.size.gap,
    marginBottom: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  focused: {
    transform: [{ scale: 1.05 }],
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  hint: {
    marginTop: 2,
    opacity: 0.85,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
