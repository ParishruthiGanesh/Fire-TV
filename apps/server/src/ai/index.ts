import { env } from '../env.js';
import { LocalAiProvider } from './local.js';
import { AnthropicAiProvider } from './anthropic.js';
import { BedrockAiProvider } from './bedrock.js';
import type { AiProvider } from './types.js';
import type { DraftExtraction, TurnUnderstanding } from '@alongside/shared';

export type { AiProvider } from './types.js';
export { LocalAiProvider } from './local.js';

export interface AiStatus {
  configured: string;
  active: string;
  offline: boolean;
  lastError: string | null;
  fallbackCount: number;
}

/**
 * Wraps a hosted provider so an AI outage degrades instead of failing.
 *
 * If the model call errors, times out or returns something the schema rejects,
 * we fall back to the deterministic provider and record why. The product keeps
 * working with buttons and approved text — which matters a great deal more
 * here than a clever sentence.
 */
export class AiService implements AiProvider {
  readonly name: string;
  readonly offline: boolean;
  private lastError: string | null = null;
  private fallbackCount = 0;
  private readonly fallback = new LocalAiProvider();

  constructor(private readonly primary: AiProvider) {
    this.name = primary.name;
    this.offline = primary.offline;
  }

  status(): AiStatus {
    return {
      configured: env.aiProvider,
      active: this.primary.name,
      offline: this.primary.offline,
      lastError: this.lastError,
      fallbackCount: this.fallbackCount,
    };
  }

  async extractDraft(...args: Parameters<AiProvider['extractDraft']>): Promise<DraftExtraction> {
    return this.guard('extractDraft', () => this.primary.extractDraft(...args), () => this.fallback.extractDraft(...args));
  }

  async understandTurn(...args: Parameters<AiProvider['understandTurn']>): Promise<TurnUnderstanding> {
    return this.guard('understandTurn', () => this.primary.understandTurn(...args), () => this.fallback.understandTurn(...args));
  }

  async matchAlternative(...args: Parameters<AiProvider['matchAlternative']>) {
    return this.guard('matchAlternative', () => this.primary.matchAlternative(...args), () => this.fallback.matchAlternative(...args));
  }

  private async guard<T>(label: string, run: () => Promise<T>, recover: () => Promise<T>): Promise<T> {
    if (this.primary.offline) return run();
    try {
      const result = await withTimeout(run(), 20_000);
      this.lastError = null;
      return result;
    } catch (error) {
      this.fallbackCount += 1;
      this.lastError = `${label}: ${error instanceof Error ? error.message : String(error)}`;
      // eslint-disable-next-line no-console
      console.warn(`[ai] ${this.lastError} — using deterministic fallback`);
      return recover();
    }
  }
}

export function createAiProvider(): AiService {
  switch (env.aiProvider) {
    case 'anthropic': {
      if (!env.anthropicApiKey) {
        console.warn('[ai] ALONGSIDE_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — using local rules');
        return new AiService(new LocalAiProvider());
      }
      return new AiService(new AnthropicAiProvider(env.anthropicApiKey, env.anthropicModel));
    }
    case 'bedrock':
      return new AiService(new BedrockAiProvider(env.bedrockRegion, env.bedrockModelId));
    case 'local':
    default:
      return new AiService(new LocalAiProvider());
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
