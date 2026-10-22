import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';

export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'playpause' | 'menu' | 'rewind' | 'forward';

const native = NativeModules.AlongsideRemoteKeys as { setEnabled(enabled: boolean): void } | undefined;

/** Hand key handling back to Android (so the on-screen keyboard works). */
export function setRemoteCapture(enabled: boolean): void {
  native?.setEnabled(enabled);
}

/**
 * Subscribe to remote presses.
 *
 * The handler is kept in a ref so a screen can read fresh state without
 * re-subscribing on every render — a dropped key press on a television reads
 * as a broken remote, and people stop trusting the device.
 */
export function useRemote(handler: (key: RemoteKey) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = DeviceEventEmitter.addListener('alongsideRemoteKey', (key: RemoteKey) => {
      ref.current(key);
    });
    return () => subscription.remove();
  }, [enabled]);
}
