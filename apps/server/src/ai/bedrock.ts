import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
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
 * Amazon Bedrock via the Converse API.
 *
 * Same three jobs, same schemas, same validation as the Anthropic provider —
 * only the transport differs, which is the point of the adapter. Selected with
 * ALONGSIDE_AI_PROVIDER=bedrock and standard AWS credentials in the
 * environment. See docs/INTEGRATIONS.md for what has and has not been run
 * against a live Bedrock account in this build.
 */
export class BedrockAiProvider implements AiProvider {
  readonly name = 'bedrock';
  readonly offline = false;
  private readonly client: BedrockRuntimeClient;

  constructor(
    region: string,
    private readonly modelId: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
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
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: args.system }],
        messages: [{ role: 'user', content: [{ text: args.user }] }],
        inferenceConfig: { maxTokens: args.maxTokens, temperature: 0 },
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: args.toolName,
                description: args.description,
                inputSchema: { json: args.schema as never },
              },
            },
          ],
          toolChoice: { tool: { name: args.toolName } },
        },
      }),
    );
    const block = response.output?.message?.content?.find((c) => 'toolUse' in c && c.toolUse);
    const toolUse = block && 'toolUse' in block ? block.toolUse : undefined;
    if (!toolUse?.input) throw new Error('Bedrock response did not contain the expected tool call');
    return toolUse.input;
  }
}
