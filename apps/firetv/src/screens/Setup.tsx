import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme, scaled } from '../theme';
import { TvButton, TvButtonRow } from '../components/TvButton';
import { useRemote, setRemoteCapture } from '../remote';
import { TvClient, normalise } from '../client';

/**
 * First-run setup: where the household backend is, and the pairing code.
 *
 * Typing on a remote is unpleasant, so there are only two fields and the
 * television's own keyboard is used for both. While a field is open, key
 * handling is handed back to Android so the keyboard behaves normally.
 */
export default function Setup({
  onPaired,
  initialBaseUrl,
}: {
  onPaired: (baseUrl: string, token: string, householdName: string) => void;
  initialBaseUrl: string;
}) {
  // Deliberately empty rather than pre-filled: editing a 24-character default
  // with a remote control is far worse than typing a short address once.
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<null | 'url' | 'code'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const urlRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  const actions = [
    { label: 'Server address', hint: baseUrl || 'not set yet', run: () => openField('url') },
    { label: 'Pairing code', hint: code || 'six characters', run: () => openField('code') },
    { label: 'Connect', hint: 'start using Alongside', run: () => connect() },
  ];

  const openField = (field: 'url' | 'code') => {
    setEditing(field);
    setRemoteCapture(false);
    setTimeout(() => (field === 'url' ? urlRef.current : codeRef.current)?.focus(), 60);
  };

  /**
   * Hand the remote back to the screen.
   *
   * Blurring explicitly matters: dismissing the on-screen keyboard does not by
   * itself release the text field, and a field that still holds Android's
   * focus swallows the directional pad — which leaves someone stuck on this
   * screen with a remote that appears to have stopped working.
   */
  const closeField = useCallback(() => {
    urlRef.current?.blur();
    codeRef.current?.blur();
    setEditing(null);
    setRemoteCapture(true);
  }, []);

  // The keyboard closing is the signal that editing is over, however it was
  // dismissed — Back, the keyboard's own tick, or finishing the line.
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', closeField);
    return () => hidden.remove();
  }, [closeField]);

  // While a field is open, Back closes it rather than leaving the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!editing) return false;
      closeField();
      return true;
    });
    return () => subscription.remove();
  }, [editing, closeField]);

  useEffect(() => () => setRemoteCapture(true), []);

  useRemote((key) => {
    if (editing) return;
    if (key === 'down' || key === 'right') setFocus((f) => (f + 1) % actions.length);
    else if (key === 'up' || key === 'left') setFocus((f) => (f - 1 + actions.length) % actions.length);
    else if (key === 'select') actions[focus]?.run();
  }, true);

  const connect = async () => {
    const url = normalise(baseUrl);
    if (!url) {
      setStatus('Enter the address of the Alongside server first.');
      return;
    }
    if (code.trim().length < 4) {
      setStatus('Enter the six-character pairing code from the dashboard.');
      return;
    }
    setBusy(true);
    setStatus('Connecting…');
    try {
      const result = await TvClient.pair(url, code);
      await TvClient.saveSettings(url, result.token);
      onPaired(url, result.token, result.householdName);
    } catch (error: any) {
      setStatus(error?.message ?? 'That did not work. Check the address and the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Set up Alongside</Text>
      <Text style={styles.body}>
        Open the caregiver dashboard, go to Household → Pairing, and read the six-character code. Enter the address
        of the Alongside server on your home network below.
      </Text>

      <View style={styles.fields}>
        <View style={[styles.field, editing === 'url' && styles.fieldActive]}>
          <Text style={styles.fieldLabel}>Server address</Text>
          <TextInput
            ref={urlRef}
            value={baseUrl}
            onChangeText={setBaseUrl}
            onBlur={closeField}
            onSubmitEditing={closeField}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            placeholder="http://192.168.1.10:4000"
            placeholderTextColor="rgba(247,243,236,0.35)"
          />
        </View>
        <View style={[styles.field, editing === 'code' && styles.fieldActive]}>
          <Text style={styles.fieldLabel}>Pairing code</Text>
          <TextInput
            ref={codeRef}
            value={code}
            onChangeText={(value) => setCode(value.toUpperCase())}
            onBlur={closeField}
            onSubmitEditing={closeField}
            selectTextOnFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            style={[styles.input, styles.codeInput]}
            placeholder="ABC123"
            placeholderTextColor="rgba(247,243,236,0.35)"
          />
        </View>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <TvButtonRow>
        {actions.map((action, index) => (
          <TvButton
            key={action.label}
            label={action.label}
            hint={action.hint}
            focused={!editing && focus === index}
            tone={index === 2 ? 'primary' : 'normal'}
            onPress={action.run}
          />
        ))}
      </TvButtonRow>
      {busy ? <Text style={styles.status}>Working…</Text> : null}
      <Text style={styles.footnote}>
        Use the directional pad to move and the centre button to choose. While the keyboard is open it takes over
        the pad — press Back to close it and carry on.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: theme.size.safe, justifyContent: 'center' },
  title: { color: theme.colour.text, fontSize: scaled(theme.text.hero, 1), fontWeight: '700', marginBottom: 12 },
  body: { color: theme.colour.textSoft, fontSize: theme.text.body, marginBottom: 26, maxWidth: 760, lineHeight: 36 },
  fields: { flexDirection: 'row', marginBottom: 18 },
  field: {
    backgroundColor: theme.colour.panel,
    borderRadius: theme.size.radius,
    borderWidth: 3,
    borderColor: 'transparent',
    padding: 14,
    marginRight: theme.size.gap,
    minWidth: 320,
  },
  fieldActive: { borderColor: theme.colour.amber },
  fieldLabel: { color: theme.colour.teal, fontSize: theme.text.small, marginBottom: 4, letterSpacing: 1 },
  input: { color: theme.colour.text, fontSize: theme.text.label, padding: 0 },
  codeInput: { letterSpacing: 6, fontSize: theme.text.body },
  status: { color: theme.colour.amber, fontSize: theme.text.label, marginBottom: 14 },
  footnote: { color: theme.colour.textSoft, fontSize: theme.text.small, marginTop: 20 },
});
