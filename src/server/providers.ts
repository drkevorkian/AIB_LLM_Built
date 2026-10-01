import { setTimeout as delay } from 'node:timers/promises';
import type { Agent, ContextSnapshot } from '../shared/contracts.js';

export interface ProviderInput {
  agent: Agent;
  snapshot: ContextSnapshot;
  prompt: string;
  kind: 'answer' | 'synthesis';
  includedAnswers: { author: string; body: string }[];
  expectedRespondents: string[];
  missingRespondents: string[];
}
export type ProviderEvent =
  { type: 'delta'; text: string } | { type: 'complete' } | { type: 'refused'; reason: string };
export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: { streaming: boolean; cancellation: boolean; remote: boolean };
  generate(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}

export class ProviderRefusal extends Error {}

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
