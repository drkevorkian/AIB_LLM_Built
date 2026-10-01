import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { SendInput } from '../src/shared/contracts.js';
import type { ProviderAdapter, ProviderEvent, ProviderInput } from '../src/server/providers.js';

export function command(recipientIds: string[], extra: Partial<SendInput> = {}): SendInput {
  return {
    clientId: randomUUID(),
    body: 'Investigate duplicate delivery.',
    type: 'question',
    recipientIds,
    policy: 'all',
    quorum: 1,
    synthesisAgentId: null,
    threadId: null,
    replyTo: null,
    deadlineSeconds: 120,
    ...extra,
  };
}
export async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Condition did not become true.');
    await new Promise((done) => setTimeout(done, 5));
  }
}
export class ControlledProvider implements ProviderAdapter {
  readonly id = 'test';
  readonly capabilities = { streaming: true, cancellation: true, remote: false };
  inputs: ProviderInput[] = [];
  releases: (() => void)[] = [];
  endings: ('complete' | 'fail' | 'refuse' | 'empty' | 'partial')[] = [];
  actions: (unknown | ((input: ProviderInput) => unknown))[] = [];
  answers: string[] = [];
  async *generate(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const index = this.inputs.length;
    this.inputs.push(input);
    const ending = this.endings[index] ?? 'complete';
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    this.releases.push(release);
    signal.addEventListener('abort', release, { once: true });
    try {
      const action = this.actions[index];
      if (input.kind === 'decision' && action !== undefined)
        yield { type: 'action', action: typeof action === 'function' ? action(input) : action };
      else if (ending !== 'empty' && ending !== 'refuse')
        yield {
          type: 'delta',
          text: this.answers[index] ?? `${input.agent.name} independent answer ${index}.`,
        };
      await gate;
      if (ending === 'fail') throw new Error('Deliberate fixture failure.');
      if (ending === 'refuse') {
        yield { type: 'refused', reason: 'Deliberate fixture refusal.' };
        return;
      }
      if (ending !== 'partial') yield { type: 'complete' };
    } finally {
      signal.removeEventListener('abort', release);
    }
  }
}
