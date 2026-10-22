import Anthropic from '@anthropic-ai/sdk';
import {
  draftExtractionSchema,
  turnUnderstandingSchema,
  type DraftExtraction,
  type TurnUnderstanding,
} from '@alongside/shared';
import {
  ALTERNATIVE_SYSTEM_PROMPT,
  ALTERNATIVE_TOOL_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_TOOL_SCHEMA,
  TURN_SYSTEM_PROMPT,
  TURN_TOOL_SCHEMA,
  alternativeUserMessage,
  draftUserMessage,
  turnUserMessage,
} from './prompts.js';
import type {
  AiProvider,
  AlternativeMatch,
  AlternativeMatchInput,
  DraftExtractionInput,
  TurnInput,
} from './types.js';

/**
 * Claude via the Anthropic Messages API.
 *
 * Structured output is forced with a single tool and `tool_choice`, and every
 * result is parsed through the same zod schema the deterministic provider
 * uses, so a malformed or creative response is rejected rather than stored.
 * The API key stays on the server; no client ever sees it.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly offline = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async extractDraft(input: DraftExtractionInput): Promise<DraftExtraction> {
    const raw = await this.callTool({
      system: DRAFT_SYSTEM_PROMPT,
      user: draftUserMessage(input),
      toolName: 'emit_routine_draft',
      description: 'Return the complete updated routine draft.',
      schema: DRAFT_TOOL_SCHEMA,
      maxTokens: 2048,
    });
    return draftExtractionSchema.parse(raw);
  }

  async understandTurn(input: TurnInput): Promise<TurnUnderstanding> {
    const raw = await this.callTool({
      system: TURN_SYSTEM_PROMPT,
      user: turnUserMessage(input),
      toolName: 'emit_intent',
      description: 'Report what the person said.',
      schema: TURN_TOOL_SCHEMA,
      maxTokens: 512,
    });
    return turnUnderstandingSchema.parse(raw);
  }

  async matchAlternative(input: AlternativeMatchInput): Promise<AlternativeMatch> {
    const raw = (await this.callTool({
      system: ALTERNATIVE_SYSTEM_PROMPT,
      user: alternativeUserMessage(input),
      toolName: 'emit_alternative_choice',
      description: 'Pick the approved alternative that fits, or null.',
      schema: ALTERNATIVE_TOOL_SCHEMA,
      maxTokens: 256,
    })) as AlternativeMatch;
    const index =
      typeof raw.index === 'number' && raw.index >= 0 && raw.index < input.alternatives.length ? raw.index : null;
    return { index, confidence: Number(raw.confidence ?? 0) };
  }

  private async callTool(args: {
    system: string;
    user: string;
    toolName: string;
    description: string;
    schema: unknown;
    maxTokens: number;
  }): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: args.maxTokens,
      system: args.system,
      tools: [
        {
          name: args.toolName,
          description: args.description,
          input_schema: args.schema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: args.toolName },
      messages: [{ role: 'user', content: args.user }],
    });
    const block = response.content.find((c) => c.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('Anthropic response did not contain the expected tool call');
    }
    return block.input;
  }
}
