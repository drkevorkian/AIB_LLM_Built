import { setTimeout as delay } from 'node:timers/promises';
import type {
  Agent,
  ContextSnapshot,
  ProviderStatus,
  TokenUsage,
  CollectionContext,
} from '../shared/contracts.js';

export interface ProviderInput {
  agent: Agent;
  snapshot: ContextSnapshot;
  prompt: string;
  kind: 'answer' | 'synthesis' | 'decision';
  includedAnswers: { author: string; body: string }[];
  expectedRespondents: string[];
  missingRespondents: string[];
  collection?: CollectionContext;
  relay?: { step: number; total: number };
  discussion?: {
    id: string;
    allowedPeerIds: string[];
    roundsUsed: number;
    maxRounds: number;
    turnsRemaining: number;
    repairReason?: string;
  };
}
/** The engine validates actions and dispatches only after provider completion. */
export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete' }
  | { type: 'refused'; reason: string }
  | { type: 'metadata'; requestId?: string; usage?: TokenUsage }
  | { type: 'action'; action: unknown };
export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: { streaming: boolean; cancellation: boolean; remote: boolean };
  generate(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  connections?(): ProviderStatus[];
  models?(provider: string, baseUrl: string, signal: AbortSignal): Promise<string[]>;
  validateAgent?(agent: Agent): void;
}

export class ProviderRefusal extends Error {}
/** Only safe, application-authored explanations reach transcripts or diagnostics. */
export class ProviderError extends Error {}
export class AgentActionError extends Error {}

/** Deterministic plumbing demonstration. This is deliberately not represented as an LLM. */
export class SimulatedProvider implements ProviderAdapter {
  readonly id = 'simulated';
  readonly capabilities = { streaming: true, cancellation: true, remote: false };

  async *generate(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const index = input.snapshot.agents.findIndex((a) => a.id === input.agent.id);
    const slow = input.prompt.includes('[simulate:slow]');
    await delay(slow ? 4000 : 250 + index * 220, undefined, { signal });
    if (input.prompt.includes('[simulate:fail]')) throw new Error('Simulated provider failure.');
    if (input.prompt.includes('[simulate:refuse]')) {
      yield { type: 'refused', reason: 'Simulated refusal; no eligible answer was produced.' };
      return;
    }
    if (input.discussion) {
      const followUp =
        input.prompt.includes('[simulate:follow-up]') && input.discussion.roundsUsed === 1;
      const peerCount = followUp ? 1 : input.discussion.allowedPeerIds.length;
      const ask =
        peerCount > 0 &&
        (input.discussion.roundsUsed === 0 || followUp) &&
        input.discussion.roundsUsed < input.discussion.maxRounds &&
        input.discussion.turnsRemaining >= peerCount + 1;
      const target = input.discussion.allowedPeerIds[0]!;
      const reply = followUp
        ? (input.snapshot.messages.findLast((m) => m.authorId === target && m.type === 'answer')
            ?.id ?? null)
        : null;
      yield {
        type: 'action',
        action: {
          kind: ask ? 'ask' : 'finish',
          body: ask
            ? `SIMULATED AGENT QUESTION · ${input.agent.name}\n\n${followUp ? 'Review your preceding answer and identify the most useful test.' : 'Give your independent perspective on the original request: ' + input.prompt}`
            : `SIMULATED DISCUSSION RESULT · ${input.agent.name}\n\nReviewed ${input.includedAnswers.length} collected answers. This deterministic fixture verifies agent-chosen routing; no real reasoning was performed.`,
          recipientIds: ask ? (followUp ? [target] : input.discussion.allowedPeerIds) : [],
          policy: 'all',
          quorum: 1,
          replyTo: reply,
        },
      };
      yield { type: 'complete' };
      return;
    }
    let text: string;
    if (input.kind === 'synthesis') {
      text =
        `SIMULATED SYNTHESIS\n\nCollected ${input.includedAnswers.length} attributed answers before this turn began.\n\n` +
        input.includedAnswers
          .map(
            (a, i) =>
              `${i + 1}. ${a.author}: ${a.body.split('\n').find((line) => line.startsWith('Perspective:')) ?? 'Response preserved in the thread.'}`,
          )
          .join('\n') +
        `\n\nNot included in the closed set: ${input.missingRespondents.join(', ') || 'none'}.` +
        '\n\nThe originals remain separate. A live model will compare evidence and unresolved disagreements here. This fixture verifies the collection barrier, not the substance of the answers.';
    } else {
      const perspectives = [
        'Define the boundaries, then identify dependencies and a measurable outcome.',
        'Inspect failure transitions, duplicate events, and the evidence needed to reproduce them.',
        'Check the user-visible behavior and test the assumptions behind the proposed approach.',
      ];
      text =
        `SIMULATED RESPONSE · ${input.agent.name}\n\nPerspective: ${perspectives[index] ?? perspectives[0]}\n\n` +
        `Received: “${input.prompt.slice(0, 180)}${input.prompt.length > 180 ? '…' : ''}”\n\n` +
        `Context: ${input.snapshot.messages.length} source messages, through sequence ${input.snapshot.sequence}. Role: ${input.agent.role}\n\n` +
        'This deterministic agent demonstrates routing, independent context, and streamed delivery. It does not perform model reasoning or contact an external provider.';
    }
    const chunks = text.match(/[\s\S]{1,48}/g) ?? [];
    for (const chunk of chunks) {
      await delay(55, undefined, { signal });
      yield { type: 'delta', text: chunk };
    }
    yield { type: 'complete' };
  }
}
