import { randomBytes, randomUUID } from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function token(): string {
  return randomBytes(24).toString('base64url');
}

/** Human-readable pairing code: no 0/O/1/I so it can be read off a TV screen. */
export function pairingCode(): string {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY2346789';
  let out = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
