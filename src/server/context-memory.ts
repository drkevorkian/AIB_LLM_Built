import { createHash } from 'node:crypto';
import type {
  ContextSnapshot,
  ContextSummary,
  Message,
  Room,
  SummaryContext,
  SummarySource,
} from '../shared/contracts.js';
import type { ProviderInput } from './providers.js';
import { providerPrompt } from './live-providers.js';
import { AppError } from './errors.js';
import { agentLabel } from '../shared/contracts.js';

export function sourceHash(message: Pick<Message, 'body'>): string {
  // JSON preserves exact code units, including distinct lone surrogates that UTF-8 replaces.
  return createHash('sha256').update(JSON.stringify(message.body)).digest('hex');
}
export function summarySource(room: Room, message: Message): SummarySource {
  const points = Array.from(message.body);
  const truncated = points.length > 320;
  const decision = room.jobs.find((job) => job.messageId === message.id)?.agentAction;
  const routing = decision ? (({ body: _body, ...fields }) => fields)(decision) : undefined;
  return {
    id: message.id,
    authorId: message.authorId,
    authorName:
      message.authorId === 'human'
        ? 'Human'
        : agentLabel(room, message.authorId, message.snapshotId),
    sequence: message.sequence,
    type: message.type,
    sha256: sourceHash(message),
    excerpt: truncated
      ? points.slice(0, 160).join('') +
        '\n[Excerpt omits original text; retrieve the source.]\n' +
        points.slice(-160).join('')
      : message.body,
    truncated,
    ...(routing ? { decision: structuredClone(routing) } : {}),
  };
}
export function assertSummarySources(room: Room, summary: ContextSummary): void {
  if (summary.invalidatedAt)
    throw new AppError(
      410,
      'This summary was invalidated by source deletion. Create a new reviewed summary.',
    );
  for (const source of summary.sources) {
    const original = room.messages.find((message) => message.id === source.id);
    if (
      !original ||
      original.threadId !== summary.threadId ||
      original.status !== 'complete' ||
      original.authorId !== source.authorId ||
      original.sequence !== source.sequence ||
      original.type !== source.type ||
      sourceHash(original) !== source.sha256
    )
      throw new AppError(
        409,
        'A summary source changed or is unavailable. Review the original sources and create a new summary.',
      );
  }
}
export function summaryContext(
  summary: ContextSummary,
  retrievedSourceIds: string[],
): SummaryContext {
  const { clientId: _clientId, commandHash: _commandHash, ...context } = structuredClone(summary);
  return { ...context, retrievedSourceIds: [...retrievedSourceIds] };
}
export function selectSummaryContext(
  room: Room,
  summary: ContextSummary,
  messages: ContextSnapshot['messages'],
  retrievedSourceIds: string[],
): { messages: ContextSnapshot['messages']; memory: SummaryContext } {
  assertSummarySources(room, summary);
  const sourceIds = new Set(summary.sources.map((source) => source.id));
  if (retrievedSourceIds.some((id) => !sourceIds.has(id)))
    throw new AppError(400, 'Retrieved sources must belong to the selected summary.');
  const selected = new Set(retrievedSourceIds);
  const retained = messages.filter(
    (message) => !sourceIds.has(message.id) || selected.has(message.id),
  );
  for (const id of retrievedSourceIds)
    if (!retained.some((message) => message.id === id))
      retained.push({
        ...room.messages.find((message) => message.id === id)!,
        authorName: summary.sources.find((source) => source.id === id)!.authorName,
      });
  retained.sort(
    (a, b) =>
      room.messages.find((message) => message.id === a.id)!.sequence -
      room.messages.find((message) => message.id === b.id)!.sequence,
  );
  return { messages: retained, memory: summaryContext(summary, retrievedSourceIds) };
}

/** Counts the exact application system/user strings, not provider tokenization or protocol overhead. */
export function contextCharacters(input: ProviderInput): number {
  const prompt = providerPrompt(input);
  return prompt.system.length + prompt.user.length;
}
export function fitContext(input: ProviderInput, protectedIds: Set<string>): ContextSnapshot {
  const policy = input.agent.contextPolicy;
  if (!policy) return input.snapshot;
  const prior = input.snapshot.delivery;
  const original = input.snapshot;
  const omitted = prior?.omittedMessageIds ?? [];
  const candidateIds = prior
    ? []
    : original.messages
        .filter((message) => !protectedIds.has(message.id))
        .map((message) => message.id);
  function candidate(count: number): ContextSnapshot {
    const excluded = new Set(candidateIds.slice(0, count));
    return {
      ...structuredClone(original),
      messages: original.messages
        .filter((message) => !excluded.has(message.id))
        .map((message) => ({ ...message })),
      delivery: {
        agentId: input.agent.id,
        provider: input.agent.provider,
        model: input.agent.model,
        maxCharacters: policy!.maxCharacters,
        overflow: policy!.overflow,
        measuredCharacters: 0,
        omittedMessageIds: [...omitted, ...excluded],
      },
    };
  }
  let selected = candidate(0);
  const length = (snapshot: ContextSnapshot) => contextCharacters({ ...input, snapshot });
  if (length(selected) > policy.maxCharacters) {
    if (policy.overflow === 'reject' || prior)
      throw new AppError(
        413,
        'The frozen model context budget is exceeded. No provider invocation or turn was consumed. Ask a new question with a reviewed budget or shorter context.',
      );
    if (length(candidate(candidateIds.length)) > policy.maxCharacters)
      throw new AppError(
        413,
        'Protected instructions, request, summary, retrieved sources or collected answers exceed the frozen model context budget. No provider invocation or turn was consumed.',
      );
    let low = 1;
    let high = candidateIds.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (length(candidate(middle)) <= policy.maxCharacters) high = middle;
      else low = middle + 1;
    }
    selected = candidate(low);
  }
  selected.delivery!.measuredCharacters = length(selected);
  return selected;
}
