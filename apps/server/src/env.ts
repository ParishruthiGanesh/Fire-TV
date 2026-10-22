import path from 'node:path';
import fs from 'node:fs';

function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
    break;
  }
}
loadDotEnv();

const dataDir = process.env.ALONGSIDE_DATA_DIR
  ? path.resolve(process.env.ALONGSIDE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbPath: process.env.ALONGSIDE_DB_PATH ?? path.join(dataDir, 'alongside.db'),
  uploadDir: process.env.ALONGSIDE_UPLOAD_DIR ?? path.join(dataDir, 'uploads'),
  /** 'local' | 'anthropic' | 'bedrock'. 'local' needs no credentials. */
  aiProvider: (process.env.ALONGSIDE_AI_PROVIDER ?? 'local').toLowerCase(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  bedrockRegion: process.env.AWS_REGION ?? 'us-east-1',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  /** Caregiver dashboard token. Single household in this hackathon build. */
  caregiverToken: process.env.ALONGSIDE_CAREGIVER_TOKEN ?? 'dev-caregiver-token',
  /** Allowed Origin values for the MCP endpoint (DNS-rebinding protection). */
  mcpAllowedOrigins: (process.env.ALONGSIDE_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  publicBaseUrl: process.env.ALONGSIDE_PUBLIC_BASE_URL ?? '',
  /** Seconds between scheduler sweeps. */
  schedulerIntervalMs: Number(process.env.ALONGSIDE_SCHEDULER_INTERVAL_MS ?? 5000),
  /** Minutes after which an announced occurrence with no report is "unconfirmed". */
  unconfirmedAfterMinutes: Number(process.env.ALONGSIDE_UNCONFIRMED_AFTER_MINUTES ?? 120),
  /**
   * How late a reminder may still be announced. Past this window the moment
   * has gone, so we stay quiet rather than announce something stale (and the
   * occurrence is never recorded as "unconfirmed", because nobody was asked).
   */
  announceGraceMinutes: Number(process.env.ALONGSIDE_ANNOUNCE_GRACE_MINUTES ?? 45),
};

export function ensureDirs(): void {
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.mkdirSync(env.uploadDir, { recursive: true });
}
