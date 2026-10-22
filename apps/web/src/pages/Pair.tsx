import React, { useState } from 'react';
import { Api } from '../api';
import { Notice } from '../components/common';

/**
 * Pairing screen for the voice client.
 *
 * The same six-character code the television uses. A device never holds the
 * caregiver's credential; it swaps the code for a token scoped to this
 * household and this device kind.
 */
export default function Pair({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await new Api('').pair(code.trim().toUpperCase(), 'voice', 'Web voice client');
      onPaired(result.token);
    } catch (e: any) {
      setError(e?.message ?? 'That code was not recognised.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page voice-shell stack">
      <section className="card stack">
        <h1>Connect the voice client</h1>
        <p className="muted">
          Enter the six-character pairing code from the caregiver dashboard (Settings → Pairing), or from the Fire TV
          app's setup screen.
        </p>
        <input
          type="text"
          className="mono"
          value={code}
          maxLength={8}
          placeholder="ABC123"
          style={{ fontSize: '1.6rem', letterSpacing: '0.18em', textAlign: 'center' }}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn big" disabled={busy || code.trim().length < 4} onClick={submit}>
          Pair this device
        </button>
      </section>
    </div>
  );
}
