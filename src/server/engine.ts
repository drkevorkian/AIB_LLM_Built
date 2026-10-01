import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Agent,
  AgentSettingsInput,
  ContextSnapshot,
  CreateRoomInput,
  Job,
  Message,
  Request,
  Room,
  SendInput,
  SendResult,
  ProviderStatus,
  AgentAction,
  Discussion,
  AppSettings,
  WorkspaceSettingsInput,
  AddAgentInput,
  AgentActivationInput,
  WorkspaceArchiveInput,
  ThreadSettingsInput,
} from '../shared/contracts.js';
import {
  agentActionSchema,
  agentSettingsSchema,
  createRoomSchema,
  sendSchema,
  workspaceSettingsSchema,
  addAgentSchema,
  agentActivationSchema,
  isAgentActive,
  agentLabel,
  hasPendingWork,
  maxParticipants,
  workspaceArchiveSchema,
  threadSettingsSchema,
} from '../shared/contracts.js';
import { AppError } from './errors.js';
import type { ProviderAdapter, ProviderInput } from './providers.js';
import { AgentActionError, ProviderError, ProviderRefusal } from './providers.js';
import { RoomStore } from './store.js';

interface EngineOptions {
  now?: () => Date;
  id?: () => string;
  autoSchedule?: boolean;
  concurrency?: number;
}
const terminal = new Set(['completed', 'failed', 'refused', 'cancelled', 'interrupted']);

export class ConversationEngine extends EventEmitter {
  private now: () => Date;
  private id: () => string;
  private active = new Map<string, { roomId: string; agentId: string; abort: AbortController }>();
  private connectionChecks = new Map<string, AbortController>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private concurrency: number;

  constructor(
    readonly store: RoomStore,
    private provider: ProviderAdapter,
    options: EngineOptions = {},
  ) {
    super();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
    this.concurrency = options.concurrency ?? 4;
    this.recover();
    if (options.autoSchedule !== false) {
      this.timer = setInterval(() => this.pump(), 100);
      this.timer.unref();
    }
  }

  createRoom(raw: CreateRoomInput): Room {
    const input = createRoomSchema.parse(raw);
    const createdAt = this.timestamp();
    const definitions = [
      ['AI A', 'Architect · define boundaries and synthesize evidence', 'teal'],
      ['AI B', 'Debugger · examine transitions and failure cases', 'amber'],
      ['AI C', 'Reviewer · check assumptions and user-visible behavior', 'violet'],
    ] as const;
    const agents: Agent[] = Array.from({ length: input.participantCount }, (_, index) => ({
      id: this.id(),
      name: definitions[index]?.[0] ?? `AI ${String.fromCharCode(65 + index)}`,
      role: definitions[index]?.[1] ?? 'Contributor · provide an independent perspective',
      color: definitions[index % definitions.length]![2],
      provider: 'simulated' as const,
      model: 'simulation-v1',
      configRevision: 0,
      active: true,
    }));
    const room: Room = {
      schemaVersion: 1,
      id: this.id(),
      title: input.title,
      objective: input.objective,
      status: 'running',
      archivedAt: null,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      maxTurns: input.maxTurns,
      turnsUsed: 0,
      agents,
      agentRevisions: agents.map((agent) => ({
        agent: structuredClone(agent),
        recordedAt: createdAt,
      })),
      threads: [],
      messages: [],
      requests: [],
      jobs: [],
      snapshots: [],
      events: [],
      relays: [],
      discussions: [],
    };
    this.audit(room, 'room.created', `Room created with ${agents.length} simulated participants.`);
    this.store.create(room);
    this.changed(room.id);
    return room;
  }

  connections(): ProviderStatus[] {
    return this.provider.connections?.() ?? [];
  }

  settings(): AppSettings {
    return this.store.settings();
  }

  saveSettings(input: AppSettings): AppSettings {
    const saved = this.store.saveSettings(input);
    this.changed('settings');
    return saved;
  }

  configureWorkspace(roomId: string, raw: WorkspaceSettingsInput): void {
    const input = workspaceSettingsSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      if (
        room.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
        room.relays.some((r) => ['running', 'blocked'].includes(r.status)) ||
        room.discussions.some((d) => ['running', 'waiting', 'blocked'].includes(d.status)) ||
        room.agents.some((a) => this.connectionChecks.has(a.id))
      )
        throw new AppError(409, 'Finish or stop pending work before editing workspace settings.');
      room.maxTurns = input.maxTurns;
      this.reserve(room, 0);
      room.title = input.title;
      room.objective = input.objective;
      this.audit(
        room,
        'room.configured',
        'Workspace name, objective, and turn limit updated. Previous invocation snapshots retain their settings.',
      );
    });
    this.changed(roomId);
  }

  setWorkspaceArchived(roomId: string, raw: WorkspaceArchiveInput): Room {
    const input = workspaceArchiveSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      if (Boolean(room.archivedAt) === input.archived) return;
      if (
        input.archived &&
        (hasPendingWork(room) || room.agents.some((a) => this.connectionChecks.has(a.id)))
      )
        throw new AppError(409, 'Finish or stop pending work before archiving this workspace.');
      room.archivedAt = input.archived ? this.timestamp() : null;
      room.status = 'paused';
      this.audit(
        room,
        input.archived ? 'room.archived' : 'room.restored',
        input.archived
          ? 'Workspace archived. History and consumed turns retained; no work can be scheduled.'
          : 'Workspace restored and paused. Resume explicitly before running work.',
      );
    });
    this.changed(roomId);
    return this.store.get(roomId);
  }

  renameThread(roomId: string, threadId: string, raw: ThreadSettingsInput): Room {
    const input = threadSettingsSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      const thread = room.threads.find((t) => t.id === threadId);
      if (!thread) throw new AppError(404, 'Thread not found.');
      thread.title = input.title;
      this.audit(room, 'thread.renamed', `Thread ${thread.id} renamed to ${thread.title}.`);
    });
    this.changed(roomId);
    return this.store.get(roomId);
  }

  private assertWorkspaceOpen(room: Room): void {
    if (room.archivedAt)
      throw new AppError(
        409,
        'Restore this archived workspace before changing it or running work.',
      );
  }

  deleteRoom(roomId: string): void {
    const room = this.store.get(roomId);
    this.store.delete(roomId);
    // Commit deletion before aborting. Abort is synchronous: late stream events see the signal.
    for (const [id, task] of this.active)
      if (task.roomId === roomId) {
        task.abort.abort();
        this.active.delete(id);
      }
    for (const agent of room.agents) {
      this.connectionChecks.get(agent.id)?.abort();
      this.connectionChecks.delete(agent.id);
    }
    this.changed(roomId);
  }

  deleteThread(roomId: string, threadId: string): Room {
    const abortIds = this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      if (!room.threads.some((t) => t.id === threadId))
        throw new AppError(404, 'Thread not found.');
      room.messageSequence ??= room.messages.reduce((n, m) => Math.max(n, m.sequence), 0);
      const messageIds = new Set(
        room.messages.filter((m) => m.threadId === threadId).map((m) => m.id),
      );
      room.deletedClientIds = [
        ...new Set([
          ...(room.deletedClientIds ?? []),
          ...room.messages
            .filter((m) => m.threadId === threadId && m.clientId)
            .map((m) => m.clientId!),
        ]),
      ];
      const removedRequests = new Set(
        room.requests.filter((r) => r.threadId === threadId).map((r) => r.id),
      );
      const affectedSnapshots = new Set(
        room.snapshots.filter((s) => s.messages.some((m) => messageIds.has(m.id))).map((s) => s.id),
      );
      const affectedRequests = new Set(
        room.requests
          .filter(
            (r) =>
              removedRequests.has(r.id) ||
              affectedSnapshots.has(r.snapshotId) ||
              room.jobs.some((j) => j.requestId === r.id && affectedSnapshots.has(j.snapshotId)),
          )
          .map((r) => r.id),
      );
      const reason =
        'Source context was removed by thread deletion. Ask a new question to continue.';
      // Shared updates can appear in other threads' frozen context. Cancel that whole
      // workflow before redaction, rather than resume a partially altered invocation.
      for (const discussion of room.discussions) {
        if (
          discussion.threadId === threadId ||
          discussion.requestIds.some((id) => affectedRequests.has(id))
        ) {
          for (const id of discussion.requestIds) affectedRequests.add(id);
          if (!['completed', 'cancelled'].includes(discussion.status))
            this.cancelDiscussion(room, discussion, reason);
        }
      }
      for (const relay of room.relays) {
        if (
          relay.threadId === threadId ||
          relay.requestIds.some((id) => affectedRequests.has(id))
        ) {
          for (const id of relay.requestIds) affectedRequests.add(id);
          if (['running', 'blocked'].includes(relay.status)) {
            relay.status = 'cancelled';
            relay.error = reason;
          }
        }
      }
      for (const request of room.requests) {
        if (
          affectedRequests.has(request.id) &&
          ['collecting', 'unresolved'].includes(request.status)
        ) {
          request.status = 'cancelled';
          request.closedAt = this.timestamp();
        }
      }
      const abortIds: string[] = [];
      for (const job of room.jobs) {
        if (!affectedRequests.has(job.requestId)) continue;
        if (this.cancelJob(room, job)) job.error = reason;
        if (job.status === 'cancelled') abortIds.push(job.id);
      }
      room.threads = room.threads.filter((t) => t.id !== threadId);
      room.messages = room.messages.filter((m) => !messageIds.has(m.id));
      room.requests = room.requests.filter((r) => !removedRequests.has(r.id));
      room.jobs = room.jobs.filter((j) => !removedRequests.has(j.requestId));
      room.relays = room.relays.filter((r) => r.threadId !== threadId);
      room.discussions = room.discussions.filter((d) => d.threadId !== threadId);
      const referencedSnapshots = new Set([
        ...room.messages.map((m) => m.snapshotId),
        ...room.requests.map((r) => r.snapshotId),
        ...room.jobs.map((j) => j.snapshotId),
      ]);
      room.snapshots = room.snapshots.filter((s) => referencedSnapshots.has(s.id));
      for (const snapshot of room.snapshots) {
        const removed = snapshot.messages.filter((m) => messageIds.has(m.id));
        if (!removed.length) continue;
        snapshot.deletedMessageIds = [
          ...new Set([...(snapshot.deletedMessageIds ?? []), ...removed.map((m) => m.id)]),
        ];
        snapshot.messages = snapshot.messages.filter((m) => !messageIds.has(m.id));
      }
      this.audit(
        room,
        'thread.deleted',
        `Deleted ${messageIds.size} messages and their stored source copies. Work using the removed context was cancelled; consumed turns are retained.`,
      );
      return abortIds;
    });
    for (const id of abortIds) {
      this.active.get(id)?.abort.abort();
      this.active.delete(id);
    }
    this.changed(roomId);
    return this.store.get(roomId);
  }

  async models(provider: string, baseUrl: string): Promise<string[]> {
    if (!this.provider.models) throw new AppError(400, 'Model discovery is unavailable.');
    try {
      return await this.provider.models(provider, baseUrl, AbortSignal.timeout(15000));
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : 'Model discovery failed.');
    }
  }

  configureAgent(roomId: string, raw: AgentSettingsInput): void {
    const input = agentSettingsSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      const agent = room.agents.find((a) => a.id === input.agentId);
      if (!agent) throw new AppError(400, 'Unknown participant.');
      this.assertRosterEditable(room);
      const next: Agent = { ...agent, ...input, configRevision: (agent.configRevision ?? 0) + 1 };
      delete (next as Agent & { agentId?: string }).agentId;
      try {
        this.provider.validateAgent?.(next);
      } catch (error) {
        throw new AppError(
          400,
          error instanceof Error ? error.message : 'Invalid connection settings.',
        );
      }
      Object.assign(agent, next);
      this.recordAgent(room, agent);
      this.audit(
        room,
        'agent.configured',
        `${agent.name}: ${agent.provider} / ${agent.model}, configuration ${agent.configRevision}.`,
      );
    });
    this.changed(roomId);
  }

  addAgent(roomId: string, raw: AddAgentInput): Agent {
    const input = addAgentSchema.parse(raw);
    const agent = this.store.mutate(roomId, (room) => {
      this.assertRosterEditable(room);
      if (room.agents.length >= maxParticipants)
        throw new AppError(
          409,
          `A workspace supports at most ${maxParticipants} participant identities, including inactive ones.`,
        );
      const agent: Agent = {
        id: this.id(),
        ...input,
        color: (['teal', 'amber', 'violet'] as const)[room.agents.length % 3]!,
        provider: 'simulated',
        model: 'simulation-v1',
        configRevision: 0,
        active: true,
      };
      room.agents.push(agent);
      this.recordAgent(room, agent);
      this.audit(room, 'agent.added', `${agent.name} added in simulation (${agent.id}).`);
      return agent;
    });
    this.changed(roomId);
    return agent;
  }

  setAgentActive(roomId: string, agentId: string, raw: AgentActivationInput): void {
    const input = agentActivationSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      const agent = room.agents.find((a) => a.id === agentId);
      if (!agent) throw new AppError(400, 'Unknown participant.');
      this.assertRosterEditable(room);
      if (isAgentActive(agent) === input.active) return;
      if (!input.active && room.agents.filter(isAgentActive).length === 1)
        throw new AppError(409, 'Keep at least one active participant in this workspace.');
      agent.active = input.active;
      agent.configRevision = (agent.configRevision ?? 0) + 1;
      this.recordAgent(room, agent);
      this.audit(
        room,
        'agent.activation',
        `${agent.name} ${input.active ? 'activated' : 'deactivated'} (${agent.id}). History retained.`,
      );
    });
    this.changed(roomId);
  }

  private assertRosterEditable(room: Room): void {
    this.assertWorkspaceOpen(room);
    if (hasPendingWork(room) || room.agents.some((a) => this.connectionChecks.has(a.id)))
      throw new AppError(
        409,
        'Finish or stop pending work before editing participants. Existing context snapshots retain their original settings.',
      );
  }

  private recordAgent(room: Room, agent: Agent): void {
    (room.agentRevisions ??= []).push({
      agent: structuredClone(agent),
      recordedAt: this.timestamp(),
    });
  }

  async testConnection(roomId: string, agentId: string): Promise<{ reply: string }> {
    if (this.closed) throw new AppError(409, 'Service is shutting down.');
    const room = this.store.get(roomId);
    this.assertWorkspaceOpen(room);
    const agent = room.agents.find((a) => a.id === agentId);
    if (!agent) throw new AppError(400, 'Unknown participant.');
    if (!isAgentActive(agent))
      throw new AppError(409, 'Reactivate this participant before testing its connection.');
    if (
      this.connectionChecks.has(agentId) ||
      [...this.active.values()].some((t) => t.agentId === agentId) ||
      this.active.size + this.connectionChecks.size >= this.concurrency
    )
      throw new AppError(409, 'This participant is busy. Wait for its current request to finish.');
    const abort = new AbortController();
    this.connectionChecks.set(agentId, abort);
    const snapshot = this.snapshot({ ...room, objective: '' }, []);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
    let text = '';
    try {
      for await (const event of this.provider.generate(
        {
          agent,
          snapshot,
          prompt:
            'Reply with a short greeting identifying your participant name. This is a connection test.',
          kind: 'answer',
          includedAnswers: [],
          expectedRespondents: [],
          missingRespondents: [],
        },
        signal,
      )) {
        signal.throwIfAborted();
        if (event.type === 'refused')
          throw new ProviderRefusal('Provider refused the connection test.');
        if (event.type === 'delta') {
          text += event.text;
          if (text.length > 20000) throw new Error('Connection test output exceeds the limit.');
        }
        if (event.type === 'complete' && text.trim()) return { reply: text.slice(0, 300) };
      }
      throw new Error('Connection test did not produce a completed answer.');
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      this.connectionChecks.delete(agentId);
    }
  }

  send(roomId: string, raw: SendInput): SendResult {
    const input = sendSchema.parse(raw);
    const canonical = { ...input };
    if (!input.relayOrder.length) delete (canonical as Partial<typeof input>).relayOrder;
    if (!input.discussion) delete (canonical as Partial<typeof input>).discussion;
    const commandHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const current = this.store.get(roomId);
    this.assertWorkspaceOpen(current);
    if (current.deletedClientIds?.includes(input.clientId))
      throw new AppError(
        409,
        'This message was deleted. Start a new message instead of replaying it.',
      );
    const previous = current.messages.find((m) => m.clientId === input.clientId);
    if (previous) {
      if (previous.commandHash !== commandHash)
        throw new AppError(409, 'Send ID already used for different content.');
      const discussion = this.store
        .get(roomId)
        .discussions.find((d) => d.messageId === previous.id);
      return {
        messageId: previous.id,
        threadId: previous.threadId,
        requestId: previous.requestId,
        ...(discussion ? { discussionId: discussion.id } : {}),
      };
    }
    const result = this.store.mutate(roomId, (room) => {
      if (room.status === 'stopped')
        throw new AppError(409, 'Resume this room before sending new messages.');
      if (new Set(input.recipientIds).size !== input.recipientIds.length)
        throw new AppError(400, 'Select each recipient once.');
      const agentIds = new Set(room.agents.filter(isAgentActive).map((a) => a.id));
      if (input.recipientIds.some((id) => !agentIds.has(id)))
        throw new AppError(400, 'Unknown or inactive recipient.');
      if (input.synthesisAgentId && !agentIds.has(input.synthesisAgentId))
        throw new AppError(400, 'Unknown or inactive synthesis agent.');
      if (input.type === 'question' && !input.recipientIds.length)
        throw new AppError(400, 'A question needs at least one recipient.');
      if (input.relayOrder.length) {
        if (
          input.type !== 'question' ||
          input.synthesisAgentId ||
          input.policy !== 'all' ||
          input.recipientIds.length !== 1 ||
          input.recipientIds[0] !== input.relayOrder[0]
        )
          throw new AppError(
            400,
            'A relay is a question addressed to its first participant, without parallel collection or synthesis.',
          );
        if (input.relayOrder.some((id) => !agentIds.has(id)))
          throw new AppError(400, 'Unknown or inactive relay participant.');
      }
      if (
        input.discussion &&
        (input.type !== 'question' ||
          input.recipientIds.length !== 1 ||
          input.synthesisAgentId ||
          input.relayOrder.length ||
          input.policy !== 'all')
      )
        throw new AppError(
          400,
          'A discussion is a question addressed to one coordinator, without a relay or separate synthesis.',
        );
      if (input.type === 'update' && input.synthesisAgentId)
        throw new AppError(400, 'Updates cannot schedule synthesis.');
      if (input.synthesisAgentId && input.recipientIds.includes(input.synthesisAgentId))
        throw new AppError(400, 'Choose a separate synthesis agent.');
      if (input.policy === 'quorum' && input.quorum > input.recipientIds.length)
        throw new AppError(400, 'Quorum exceeds the recipient count.');
      const reply = input.replyTo ? room.messages.find((m) => m.id === input.replyTo) : null;
      if (input.replyTo && !reply) throw new AppError(400, 'Reply target is not in this room.');
      if (reply && input.threadId && reply.threadId !== input.threadId)
        throw new AppError(400, 'Reply target belongs to a different thread.');
      let threadId = reply?.threadId ?? input.threadId;
      if (threadId && !room.threads.some((t) => t.id === threadId))
        throw new AppError(400, 'Unknown thread.');
      if (!threadId) {
        threadId = this.id();
        room.threads.push({
          id: threadId,
          title: input.body.replace(/\s+/g, ' ').slice(0, 68),
          createdAt: this.timestamp(),
        });
      }
      const needed =
        input.type === 'question'
          ? (input.discussion?.maxTurns ??
            (input.relayOrder.length ||
              input.recipientIds.length + (input.synthesisAgentId ? 1 : 0)))
          : 0;
      this.reserve(room, needed);
      const requestId = input.type === 'question' ? this.id() : null;
      const message: Message = {
        id: this.id(),
        sequence: this.nextSequence(room),
        threadId,
        authorId: 'human',
        recipientIds: input.recipientIds,
        visibility: 'room',
        type: input.type,
        body: input.body,
        status: 'complete',
        replyTo: input.replyTo,
        requestId,
        snapshotId: null,
        createdAt: this.timestamp(),
        clientId: input.clientId,
        commandHash,
      };
      room.messages.push(message);
      let discussionId: string | undefined;
      if (requestId) {
        const relevant = room.messages.filter(
          (m) => m.status === 'complete' && (m.threadId === threadId || m.type === 'update'),
        );
        const snapshot = this.snapshot(room, relevant);
        room.snapshots.push(snapshot);
        message.snapshotId = snapshot.id;
        const request: Request = {
          id: requestId,
          messageId: message.id,
          threadId,
          recipientIds: input.recipientIds,
          policy: input.policy,
          quorum: input.quorum,
          synthesisAgentId: input.synthesisAgentId,
          snapshotId: snapshot.id,
          status: 'collecting',
          includedMessageIds: [],
          createdAt: this.timestamp(),
          deadlineAt: new Date(this.now().getTime() + input.deadlineSeconds * 1000).toISOString(),
          closedAt: null,
        };
        room.requests.push(request);
        if (input.discussion) {
          discussionId = this.id();
          request.discussionId = discussionId;
          request.phase = 'decision';
          room.discussions.push({
            id: discussionId,
            messageId: message.id,
            threadId,
            leaderId: input.recipientIds[0]!,
            allowedPeerIds: room.agents
              .filter((a) => isAgentActive(a) && a.id !== input.recipientIds[0])
              .map((a) => a.id),
            status: 'running',
            maxRounds: input.discussion.maxRounds,
            roundsUsed: 0,
            maxTurns: input.discussion.maxTurns,
            turnsUsed: 0,
            deadlineSeconds: input.deadlineSeconds,
            requestIds: [request.id],
            roundRequestIds: [],
            currentRequestId: request.id,
            resultMessageId: null,
            error: null,
            askFingerprints: [],
          });
          this.audit(
            room,
            'discussion.started',
            `Reserved ${input.discussion.maxTurns} turns and at most ${input.discussion.maxRounds} peer rounds for coordinator ${input.recipientIds[0]}.`,
          );
        }
        if (input.relayOrder.length) {
          const relayId = this.id();
          request.relayId = relayId;
          request.relayStep = 0;
          room.relays.push({
            id: relayId,
            messageId: message.id,
            threadId,
            order: input.relayOrder,
            requestIds: [request.id],
            completedSteps: 0,
            status: 'running',
            deadlineSeconds: input.deadlineSeconds,
            error: null,
          });
          this.audit(
            room,
            'relay.started',
            `Reserved ${input.relayOrder.length} sequential turns; each hop requires a completed answer.`,
          );
        }
        for (const agentId of input.recipientIds)
          room.jobs.push(
            this.job(request, agentId, input.discussion ? 'decision' : 'answer', snapshot.id),
          );
      }
      this.audit(
        room,
        'message.sent',
        `${input.type} delivered to ${input.recipientIds.length} selected participants.`,
      );
      return {
        messageId: message.id,
        threadId,
        requestId,
        ...(discussionId ? { discussionId } : {}),
      };
    });
    this.changed(roomId);
    return result;
  }

  control(roomId: string, action: 'pause' | 'resume' | 'stop'): void {
    this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      room.status = action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'stopped';
      if (action === 'stop') {
        for (const discussion of room.discussions)
          if (['running', 'waiting', 'blocked'].includes(discussion.status))
            discussion.status = 'cancelled';
        for (const relay of room.relays)
          if (relay.status === 'running' || relay.status === 'blocked') relay.status = 'cancelled';
        for (const request of room.requests) {
          if (request.status === 'collecting') {
            request.status = 'cancelled';
            request.closedAt = this.timestamp();
          }
        }
        for (const job of room.jobs) this.cancelJob(room, job);
      }
      this.audit(
        room,
        `room.${action}`,
        action === 'pause'
          ? 'New dispatches paused; active work may finish.'
          : `Room ${action} requested by the human.`,
      );
    });
    if (action === 'stop') {
      for (const task of this.active.values()) if (task.roomId === roomId) task.abort.abort();
    }
    this.changed(roomId);
  }

  stopDiscussion(roomId: string, discussionId: string): void {
    this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      const discussion = room.discussions.find((d) => d.id === discussionId);
      if (!discussion) throw new AppError(400, 'Unknown discussion.');
      if (discussion.status === 'completed' || discussion.status === 'cancelled') return;
      this.cancelDiscussion(room, discussion, 'Discussion stopped by the human.');
      this.audit(
        room,
        'discussion.stopped',
        `Discussion ${discussionId} stopped; unused reserved turns released.`,
      );
    });
    this.abortCancelled(roomId);
    this.changed(roomId);
  }

  retry(roomId: string, jobId: string): void {
    this.store.mutate(roomId, (room) => {
      this.assertWorkspaceOpen(room);
      const previous = room.jobs.find((j) => j.id === jobId);
      if (!previous || !['failed', 'interrupted'].includes(previous.status))
        throw new AppError(400, 'Only failed or interrupted work can be retried.');
      const request = room.requests.find((r) => r.id === previous.requestId)!;
      const workflowIds = new Set([
        previous.agentId,
        ...request.recipientIds,
        ...(request.synthesisAgentId ? [request.synthesisAgentId] : []),
        ...(room.relays.find((r) => r.id === request.relayId)?.order ?? []),
        ...(room.discussions.find((d) => d.id === previous.discussionId)?.allowedPeerIds ?? []),
      ]);
      if ([...workflowIds].some((id) => !room.agents.some((a) => a.id === id && isAgentActive(a))))
        throw new AppError(
          409,
          'Reactivate the participants in this workflow before retrying, or ask a new question.',
        );
      if (
        [previous.snapshotId, request.snapshotId].some(
          (id) => room.snapshots.find((s) => s.id === id)?.deletedMessageIds?.length,
        )
      )
        throw new AppError(
          409,
          'This attempt used deleted context. Ask a new question instead of retrying.',
        );
      if (
        room.status === 'stopped' ||
        request.status === 'cancelled' ||
        request.status === 'timed_out'
      )
        throw new AppError(409, 'Create a new question for cancelled or expired work.');
      if (previous.kind !== 'synthesis' && request.status === 'ready')
        throw new AppError(409, 'This response set is closed. Ask a follow-up instead.');
      const chain = room.jobs.filter(
        (j) =>
          j.requestId === request.id && j.agentId === previous.agentId && j.kind === previous.kind,
      );
      if (chain.at(-1)?.id !== previous.id)
        throw new AppError(409, 'A newer attempt already exists.');
      if (chain.length >= 3) throw new AppError(409, 'Retry limit reached; create a new question.');
      const discussion = room.discussions.find((d) => d.id === previous.discussionId);
      if (discussion) {
        if (discussion.status === 'completed' || discussion.status === 'cancelled')
          throw new AppError(409, 'This discussion is closed. Start a new one.');
        if (!this.discussionCapacity(room, discussion, previous.kind === 'answer' ? 2 : 1))
          throw new AppError(
            409,
            'This retry exceeds the discussion turn allowance. Stop it and start a new discussion.',
          );
      } else
        this.reserve(
          room,
          1 +
            (previous.kind === 'answer' &&
            request.status === 'unresolved' &&
            request.synthesisAgentId
              ? 1
              : 0),
        );
      if (previous.kind === 'synthesis') {
        const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
        const binding = room.snapshots.find((s) => s.id === previous.snapshotId)!;
        const included = request.includedMessageIds.map((id) =>
          room.messages.find((m) => m.id === id)!,
        );
        const snapshot = this.snapshot(
          { ...room, agents: binding.agents, objective: binding.objective },
          [...original.messages, ...included],
        );
        room.snapshots.push(snapshot);
        room.jobs.push({
          ...this.job(request, previous.agentId, previous.kind, snapshot.id),
          previousJobId: previous.id,
        });
      } else {
        room.jobs.push({
          ...this.job(request, previous.agentId, previous.kind, previous.snapshotId),
          previousJobId: previous.id,
        });
      }
      if (previous.kind !== 'synthesis') {
        request.status = 'collecting';
        request.closedAt = null;
        request.deadlineAt = new Date(
          this.now().getTime() + (discussion?.deadlineSeconds ?? 120) * 1000,
        ).toISOString();
        if (discussion) {
          discussion.status = previous.kind === 'decision' ? 'running' : 'waiting';
          discussion.error = null;
        }
        const relay = room.relays.find((r) => r.id === request.relayId);
        if (relay) {
          relay.status = 'running';
          relay.error = null;
        }
      }
      this.audit(room, 'job.retry', `Explicit retry of ${previous.id}; previous attempt retained.`);
    });
    this.changed(roomId);
  }

  /** Dispatch is synchronous up to persisted claims; generation proceeds independently. */
  pump(): void {
    if (this.closed) return;
    for (const initial of this.store.all()) {
      if (initial.archivedAt) continue;
      this.expire(initial.id);
      const room = this.store.get(initial.id);
      if (room.status !== 'running') continue;
      for (const job of room.jobs) {
        if (this.active.size + this.connectionChecks.size >= this.concurrency) return;
        if (
          job.status !== 'queued' ||
          this.connectionChecks.has(job.agentId) ||
          [...this.active.values()].some((t) => t.agentId === job.agentId)
        )
          continue;
        this.start(room.id, job.id);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const task of this.active.values()) task.abort.abort();
    for (const abort of this.connectionChecks.values()) abort.abort();
    // Preserve unfinished work for explicit recovery; never auto-replay a running invocation.
    this.recover();
    this.removeAllListeners();
  }

  private start(roomId: string, jobId: string): void {
    const abort = new AbortController();
    let input: ProviderInput | null = null;
    let claimedAgentId = '';
    this.store.mutate(roomId, (room) => {
      const job = room.jobs.find((j) => j.id === jobId)!;
      if (room.archivedAt || room.status !== 'running' || job.status !== 'queued') return;
      const request = room.requests.find((r) => r.id === job.requestId)!;
      if (!room.agents.some((a) => a.id === job.agentId && isAgentActive(a))) {
        this.cancelJob(room, job);
        this.collect(room, request.id);
        this.audit(room, 'job.unavailable', 'Inactive or missing participant blocked dispatch.');
        return;
      }
      if (room.turnsUsed >= room.maxTurns) {
        room.status = 'paused';
        this.audit(room, 'budget.exhausted', 'Turn limit reached.');
        return;
      }
      const snapshot = room.snapshots.find((s) => s.id === job.snapshotId)!;
      const agent = snapshot.agents.find((a) => a.id === job.agentId)!;
      const relay = room.relays.find((r) => r.id === request.relayId);
      const discussion = room.discussions.find((d) => d.id === job.discussionId);
      if (
        discussion &&
        (discussion.status === 'completed' ||
          discussion.status === 'cancelled' ||
          discussion.turnsUsed >= discussion.maxTurns)
      ) {
        this.cancelJob(room, job);
        return;
      }
      const prompt = room.messages.find(
        (m) =>
          m.id ===
          (discussion && job.kind === 'decision'
            ? discussion.messageId
            : (relay?.messageId ?? request.messageId)),
      )!.body;
      job.status = 'running';
      job.startedAt = this.timestamp();
      job.attemptId = this.id();
      job.messageId = this.id();
      room.turnsUsed += 1;
      if (discussion) discussion.turnsUsed += 1;
      room.messages.push({
        id: job.messageId,
        sequence: this.nextSequence(room),
        threadId: request.threadId,
        authorId: job.agentId,
        recipientIds:
          discussion && job.kind === 'answer' ? [discussion.leaderId, 'human'] : ['human'],
        visibility: 'room',
        type: job.kind === 'decision' ? 'answer' : job.kind,
        body: '',
        status: 'streaming',
        replyTo: request.messageId,
        requestId: request.id,
        snapshotId: snapshot.id,
        createdAt: this.timestamp(),
      });
      const sourceRequest = request.sourceRequestId
        ? room.requests.find((r) => r.id === request.sourceRequestId)
        : null;
      const includedIds =
        job.kind === 'synthesis'
          ? request.includedMessageIds
          : job.kind === 'decision'
            ? (sourceRequest?.includedMessageIds ?? [])
            : [];
      const includedAnswers = includedIds.map((id) => {
        const message = room.messages.find((m) => m.id === id)!;
        return {
          author: agentLabel(room, message.authorId, message.snapshotId),
          body: message.body,
        };
      });
      const includedAuthorIds = new Set(
        includedIds.map((id) => room.messages.find((m) => m.id === id)!.authorId),
      );
      const expectedRespondents = (sourceRequest ?? request).recipientIds.map((id) =>
        agentLabel(room, id, snapshot.id),
      );
      const missingRespondents =
        job.kind === 'synthesis' || sourceRequest
          ? (sourceRequest ?? request).recipientIds
              .filter((id) => !includedAuthorIds.has(id))
              .map((id) => agentLabel(room, id, snapshot.id))
          : [];
      input = {
        agent,
        snapshot,
        prompt,
        kind: job.kind,
        includedAnswers,
        expectedRespondents,
        missingRespondents,
        ...(relay ? { relay: { step: request.relayStep!, total: relay.order.length } } : {}),
        ...(discussion && job.kind === 'decision'
          ? {
              discussion: {
                id: discussion.id,
                allowedPeerIds: discussion.allowedPeerIds,
                roundsUsed: discussion.roundsUsed,
                maxRounds: discussion.maxRounds,
                turnsRemaining:
                  discussion.maxTurns -
                  discussion.turnsUsed -
                  room.jobs.filter((j) => j.discussionId === discussion.id && j.status === 'queued')
                    .length,
                ...(job.repairReason ? { repairReason: job.repairReason } : {}),
              },
            }
          : {}),
      };
      claimedAgentId = agent.id;
    });
    if (!input) {
      this.changed(roomId);
      return;
    }
    this.active.set(jobId, { roomId, agentId: claimedAgentId, abort });
    this.changed(roomId);
    void this.generate(roomId, jobId, input, abort.signal);
  }

  private async generate(
    roomId: string,
    jobId: string,
    input: ProviderInput,
    signal: AbortSignal,
  ): Promise<void> {
    let completed = false;
    let pendingAction: unknown;
    let actionCount = 0;
    try {
      for await (const event of this.provider.generate(input, signal)) {
        if (this.closed || signal.aborted) break;
        if (event.type === 'refused') throw new ProviderRefusal(event.reason);
        if (event.type === 'action') {
          if (input.kind !== 'decision')
            throw new ProviderError('Peer answers cannot dispatch actions.');
          pendingAction = event.action;
          actionCount += 1;
        } else if (event.type === 'metadata') {
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            if (event.requestId) job.providerRequestId = event.requestId;
            if (event.usage) job.usage = event.usage;
          });
        } else if (event.type === 'delta') {
          if (input.kind === 'decision') continue;
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            const message = room.messages.find((m) => m.id === job.messageId)!;
            if (message.body.length + event.text.length > 20000)
              throw new Error('Provider output exceeds the 20,000-character limit.');
            message.body += event.text;
          });
          this.changed(roomId);
        } else if (event.type === 'complete') {
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            const message = room.messages.find((m) => m.id === job.messageId)!;
            if (job.kind === 'decision') {
              if (actionCount !== 1)
                throw new AgentActionError(
                  'Return exactly one complete action object per decision.',
                );
              this.completeDecision(room, job, pendingAction);
              return;
            }
            if (!message.body.trim()) throw new Error('Provider returned an empty answer.');
            message.status = 'complete';
            job.status = 'completed';
            job.endedAt = this.timestamp();
            this.collect(room, job.requestId);
          });
          completed = true;
          this.abortCancelled(roomId);
          this.changed(roomId);
          break;
        }
      }
      if (!completed && !signal.aborted && !this.closed)
        throw new Error('Stream ended without a completion event.');
    } catch (error) {
      if (!this.closed && !signal.aborted) {
        this.store.mutate(roomId, (room) => {
          const job = room.jobs.find((j) => j.id === jobId)!;
          if (job.status !== 'running') return;
          job.status = error instanceof ProviderRefusal ? 'refused' : 'failed';
          job.endedAt = this.timestamp();
          // Live adapters expose only application-authored, redacted error messages.
          job.error = error instanceof Error ? error.message.slice(0, 300) : 'Provider failed.';
          room.messages.find((m) => m.id === job.messageId)!.status =
            error instanceof ProviderRefusal ? 'refused' : 'failed';
          if (!(
            error instanceof AgentActionError &&
            job.kind === 'decision' &&
            this.repairDecision(room, job)
          ))
            this.collect(room, job.requestId);
          this.audit(room, 'job.failed', `Attempt ${job.attemptId} failed.`);
        });
        this.changed(roomId);
      }
    } finally {
      this.active.delete(jobId);
    }
  }

  private collect(room: Room, requestId: string): void {
    const request = room.requests.find((r) => r.id === requestId)!;
    if (request.status !== 'collecting') return;
    const kind = request.phase === 'decision' ? 'decision' : 'answer';
    const latest = request.recipientIds.map((id) =>
      room.jobs
        .filter((j) => j.requestId === requestId && j.agentId === id && j.kind === kind)
        .at(-1)!,
    );
    const completed = latest.filter((j) => j.status === 'completed');
    const target =
      request.policy === 'all' ? latest.length : request.policy === 'any' ? 1 : request.quorum;
    if (completed.length >= target) {
      request.status = 'ready';
      request.closedAt = this.timestamp();
      request.includedMessageIds = completed.map((j) => j.messageId!);
      if (request.relayId) this.advanceRelay(room, request);
      if (request.discussionId && request.phase === 'consultation')
        this.advanceDiscussion(room, request);
      if (request.synthesisAgentId) {
        const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
        const included = request.includedMessageIds.map((id) =>
          room.messages.find((m) => m.id === id)!,
        );
        try {
          const snapshot = this.snapshot(
            { ...room, agents: original.agents, objective: original.objective },
            [...original.messages, ...included],
          );
          room.snapshots.push(snapshot);
          room.jobs.push(this.job(request, request.synthesisAgentId, 'synthesis', snapshot.id));
        } catch (error) {
          if (!(error instanceof AppError) || error.status !== 413) throw error;
          const failed = this.job(request, request.synthesisAgentId, 'synthesis', original.id);
          failed.status = 'failed';
          failed.error =
            'Synthesis context exceeds the initial 64,000-character limit. Individual answers are preserved.';
          failed.endedAt = this.timestamp();
          room.jobs.push(failed);
          this.audit(room, 'synthesis.blocked', failed.error);
        }
      }
      this.audit(
        room,
        'request.ready',
        `Collected ${completed.length}/${latest.length} answers under ${request.policy}.`,
      );
    } else if (latest.every((j) => terminal.has(j.status))) {
      request.status = 'unresolved';
      request.closedAt = this.timestamp();
      const relay = room.relays.find((r) => r.id === request.relayId);
      if (relay) {
        relay.status = 'blocked';
        relay.error =
          latest.find((j) => j.error)?.error ??
          'Relay requires a completed answer before advancing.';
      }
      const discussion = room.discussions.find((d) => d.id === request.discussionId);
      if (discussion && discussion.status !== 'cancelled' && discussion.status !== 'completed') {
        discussion.status = 'blocked';
        discussion.error =
          latest.find((j) => j.error)?.error ?? 'Required completed answers were not received.';
      }
      this.audit(room, 'request.unresolved', 'Required eligible answers were not received.');
    }
  }

  private validateAction(room: Room, job: Job, raw: unknown): AgentAction {
    const parsed = agentActionSchema.safeParse(raw);
    if (!parsed.success)
      throw new AgentActionError(
        'Use exactly the six action fields with valid types and a nonempty body.',
      );
    const action = parsed.data;
    const discussion = room.discussions.find((d) => d.id === job.discussionId)!;
    if (job.agentId !== discussion.leaderId)
      throw new AgentActionError('Only the selected coordinator can ask peers.');
    if (action.kind === 'finish') {
      if (
        action.recipientIds.length ||
        action.policy !== 'all' ||
        action.quorum !== 1 ||
        action.replyTo !== null
      )
        throw new AgentActionError(
          'For finish use recipientIds [], policy all, quorum 1, and replyTo null.',
        );
      return action;
    }
    if (
      !action.recipientIds.length ||
      new Set(action.recipientIds).size !== action.recipientIds.length ||
      action.recipientIds.some((id) => !discussion.allowedPeerIds.includes(id))
    )
      throw new AgentActionError(
        'Ask one or more distinct allowed peer IDs; never the coordinator, human, or an unknown ID.',
      );
    if (action.body.length > 12000)
      throw new AgentActionError('Peer questions must be at most 12,000 characters.');
    if (action.policy === 'quorum' && action.quorum > action.recipientIds.length)
      throw new AgentActionError('Quorum cannot exceed the selected peer count.');
    if (discussion.roundsUsed >= discussion.maxRounds)
      throw new AgentActionError(
        'The peer round limit is reached. Return finish with the evidence already collected.',
      );
    if (!this.discussionCapacity(room, discussion, action.recipientIds.length + 1))
      throw new AgentActionError(
        'The remaining allowance cannot cover these peers and your next decision. Finish or ask fewer peers.',
      );
    if (action.replyTo) {
      const snapshot = room.snapshots.find((s) => s.id === job.snapshotId)!;
      const source = room.messages.find((m) => m.id === action.replyTo);
      if (
        !source ||
        source.status !== 'complete' ||
        source.threadId !== discussion.threadId ||
        !snapshot.messages.some((m) => m.id === source.id)
      )
        throw new AgentActionError(
          'replyTo must identify a completed message in this thread and your supplied context.',
        );
      if (
        source.authorId !== 'human' &&
        source.authorId !== discussion.leaderId &&
        !action.recipientIds.includes(source.authorId)
      )
        throw new AgentActionError(
          'A follow-up to a peer answer must include that peer as a recipient.',
        );
    }
    if (discussion.askFingerprints.includes(this.askFingerprint(action)))
      throw new AgentActionError(
        'This question and recipient set already ran. Ask a different question or finish.',
      );
    return action;
  }

  /** One completed, authorized decision commits the visible message and its next jobs together. */
  private completeDecision(room: Room, job: Job, raw: unknown): void {
    const action = this.validateAction(room, job, raw);
    const discussion = room.discussions.find((d) => d.id === job.discussionId)!;
    const request = room.requests.find((r) => r.id === job.requestId)!;
    const message = room.messages.find((m) => m.id === job.messageId)!;
    message.body = action.body;
    message.type = action.kind === 'ask' ? 'question' : 'answer';
    message.status = 'complete';
    message.recipientIds = action.kind === 'ask' ? action.recipientIds : ['human'];
    if (action.replyTo) message.replyTo = action.replyTo;
    job.agentAction = action;
    job.status = 'completed';
    job.endedAt = this.timestamp();
    request.status = 'ready';
    request.closedAt = this.timestamp();
    request.includedMessageIds = [message.id];
    discussion.error = null;
    if (action.kind === 'finish') {
      discussion.status = 'completed';
      discussion.resultMessageId = message.id;
      // Late any/quorum respondents cannot prolong a finished discussion or use released turns.
      this.cancelDiscussionJobs(room, discussion);
      this.audit(
        room,
        'discussion.completed',
        `Coordinator ${discussion.leaderId} finished after ${discussion.roundsUsed} peer rounds and ${discussion.turnsUsed} turns.`,
      );
      return;
    }
    const original = room.snapshots.find((s) => s.id === job.snapshotId)!;
    let snapshot: ContextSnapshot;
    try {
      snapshot = this.snapshot(room, [...original.messages, message]);
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 413) throw error;
      discussion.status = 'blocked';
      discussion.error =
        'Peer context exceeds the 64,000-character limit. Stop this discussion and start a shorter thread.';
      this.audit(room, 'discussion.blocked', discussion.error);
      return;
    }
    snapshot.agents = structuredClone(original.agents);
    room.snapshots.push(snapshot);
    const round = this.discussionRequest(
      discussion,
      message.id,
      snapshot.id,
      action.recipientIds,
      'consultation',
    );
    round.policy = action.policy;
    round.quorum = action.quorum;
    room.requests.push(round);
    discussion.requestIds.push(round.id);
    discussion.roundRequestIds.push(round.id);
    discussion.currentRequestId = round.id;
    discussion.roundsUsed += 1;
    discussion.askFingerprints.push(this.askFingerprint(action));
    discussion.status = 'waiting';
    message.requestId = round.id;
    for (const agentId of action.recipientIds)
      room.jobs.push(this.job(round, agentId, 'answer', snapshot.id));
    this.audit(
      room,
      'discussion.asked',
      `${discussion.leaderId} asked ${action.recipientIds.join(', ')} under ${action.policy}; round ${discussion.roundsUsed}/${discussion.maxRounds}.`,
    );
  }

  private advanceDiscussion(room: Room, round: Request): void {
    const discussion = room.discussions.find((d) => d.id === round.discussionId)!;
    if (discussion.status !== 'waiting' || discussion.currentRequestId !== round.id) return;
    const original = room.snapshots.find((s) => s.id === round.snapshotId)!;
    try {
      if (!this.discussionCapacity(room, discussion, 1))
        throw new AppError(413, 'Discussion turn allowance is exhausted.');
      const included = round.includedMessageIds.map((id) =>
        room.messages.find((m) => m.id === id)!,
      );
      const snapshot = this.snapshot(room, [...original.messages, ...included]);
      snapshot.agents = structuredClone(original.agents);
      room.snapshots.push(snapshot);
      const next = this.discussionRequest(
        discussion,
        round.messageId,
        snapshot.id,
        [discussion.leaderId],
        'decision',
      );
      next.sourceRequestId = round.id;
      room.requests.push(next);
      room.jobs.push(this.job(next, discussion.leaderId, 'decision', snapshot.id));
      discussion.requestIds.push(next.id);
      discussion.currentRequestId = next.id;
      discussion.status = 'running';
      this.audit(
        room,
        'discussion.collected',
        `Closed peer set ${round.id}; coordinator continuation queued with ${included.length} attributed answers.`,
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 413) throw error;
      discussion.status = 'blocked';
      discussion.error =
        'The continuation exceeds the context or turn limit. Completed answers are preserved. Stop this discussion and start a shorter one.';
      this.audit(room, 'discussion.blocked', discussion.error);
    }
  }

  private discussionRequest(
    discussion: Discussion,
    messageId: string,
    snapshotId: string,
    recipientIds: string[],
    phase: 'decision' | 'consultation',
  ): Request {
    return {
      id: this.id(),
      messageId,
      snapshotId,
      recipientIds,
      threadId: discussion.threadId,
      discussionId: discussion.id,
      phase,
      policy: 'all',
      quorum: 1,
      synthesisAgentId: null,
      status: 'collecting',
      includedMessageIds: [],
      createdAt: this.timestamp(),
      closedAt: null,
      deadlineAt: new Date(this.now().getTime() + discussion.deadlineSeconds * 1000).toISOString(),
    };
  }

  private repairDecision(room: Room, previous: Job): boolean {
    const discussion = room.discussions.find((d) => d.id === previous.discussionId)!;
    const request = room.requests.find((r) => r.id === previous.requestId)!;
    if (
      request.status !== 'collecting' ||
      room.jobs.some((j) => j.requestId === request.id && j.repairReason) ||
      !this.discussionCapacity(room, discussion, 1)
    )
      return false;
    room.jobs.push({
      ...this.job(request, previous.agentId, 'decision', previous.snapshotId),
      previousJobId: previous.id,
      repairReason: previous.error!,
    });
    discussion.status = 'running';
    this.audit(
      room,
      'discussion.action_repair',
      'One correction attempt queued for an invalid completed action; it consumes the reserved turn allowance.',
    );
    return true;
  }

  private discussionCapacity(room: Room, discussion: Discussion, needed: number): boolean {
    return (
      discussion.turnsUsed +
        room.jobs.filter((j) => j.discussionId === discussion.id && j.status === 'queued').length +
        needed <=
      discussion.maxTurns
    );
  }

  private askFingerprint(action: AgentAction): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          action.body.replace(/\s+/g, ' ').toLowerCase(),
          [...action.recipientIds].sort(),
          action.policy,
          action.policy === 'quorum' ? action.quorum : 1,
        ]),
      )
      .digest('hex');
  }

  private cancelDiscussionJobs(room: Room, discussion: Discussion): void {
    for (const request of room.requests) {
      if (request.discussionId === discussion.id && request.status === 'collecting') {
        request.status = 'cancelled';
        request.closedAt = this.timestamp();
      }
    }
    for (const job of room.jobs) if (job.discussionId === discussion.id) this.cancelJob(room, job);
  }

  private cancelDiscussion(room: Room, discussion: Discussion, reason: string): void {
    discussion.status = 'cancelled';
    discussion.error = reason;
    this.cancelDiscussionJobs(room, discussion);
  }

  private abortCancelled(roomId: string): void {
    const room = this.store.get(roomId);
    for (const [jobId, task] of this.active)
      if (task.roomId === roomId && room.jobs.find((j) => j.id === jobId)?.status === 'cancelled')
        task.abort.abort();
  }

  /** Completion and scheduling of the next exact-message hop commit atomically. */
  private advanceRelay(room: Room, request: Request): void {
    const relay = room.relays.find((r) => r.id === request.relayId)!;
    if (relay.status !== 'running' || request.relayStep !== relay.completedSteps) return;
    relay.completedSteps += 1;
    if (relay.completedSteps === relay.order.length) {
      relay.status = 'completed';
      relay.error = null;
      this.audit(
        room,
        'relay.completed',
        `${relay.completedSteps} completed relay turns; final answer delivered to the human.`,
      );
      return;
    }
    const source = room.messages.find((m) => m.id === request.includedMessageIds[0])!;
    const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
    const nextAgent = relay.order[relay.completedSteps]!;
    try {
      const snapshot = this.snapshot(room, [...original.messages, source]);
      snapshot.agents = structuredClone(original.agents);
      room.snapshots.push(snapshot);
      const next: Request = {
        ...request,
        id: this.id(),
        messageId: source.id,
        snapshotId: snapshot.id,
        recipientIds: [nextAgent],
        status: 'collecting',
        includedMessageIds: [],
        createdAt: this.timestamp(),
        deadlineAt: new Date(this.now().getTime() + relay.deadlineSeconds * 1000).toISOString(),
        closedAt: null,
        relayStep: relay.completedSteps,
      };
      source.recipientIds = [nextAgent, 'human'];
      room.requests.push(next);
      relay.requestIds.push(next.id);
      room.jobs.push(this.job(next, nextAgent, 'answer', snapshot.id));
      this.audit(
        room,
        'relay.advanced',
        `Step ${relay.completedSteps + 1}/${relay.order.length} queued for ${nextAgent}; replies to message ${source.id}.`,
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 413) throw error;
      relay.status = 'blocked';
      relay.error =
        'Relay context exceeds the 64,000-character limit. Completed answers are preserved. Stop the relay and start a shorter thread.';
      this.audit(room, 'relay.blocked', relay.error);
    }
  }

  private expire(roomId: string): void {
    const expired = this.store
      .get(roomId)
      .requests.filter(
        (r) => r.status === 'collecting' && Date.parse(r.deadlineAt) <= this.now().getTime(),
      );
    if (!expired.length) return;
    const ids = new Set(expired.map((r) => r.id));
    const cancelled: string[] = [];
    this.store.mutate(roomId, (room) => {
      room.status = 'paused';
      for (const request of room.requests) {
        if (!ids.has(request.id)) continue;
        request.status = 'timed_out';
        request.closedAt = this.timestamp();
        const relay = room.relays.find((r) => r.id === request.relayId);
        if (relay) {
          relay.status = 'cancelled';
          relay.error = 'Relay cancelled after its response deadline.';
        }
        const discussion = room.discussions.find((d) => d.id === request.discussionId);
        if (discussion)
          this.cancelDiscussion(
            room,
            discussion,
            'Discussion cancelled after its response deadline.',
          );
        request.includedMessageIds = room.jobs
          .filter(
            (j) => j.requestId === request.id && j.kind === 'answer' && j.status === 'completed',
          )
          .map((j) => j.messageId!);
      }
      for (const job of room.jobs) {
        if (ids.has(job.requestId)) this.cancelJob(room, job);
        if (job.status === 'cancelled') cancelled.push(job.id);
      }
      this.audit(
        room,
        'request.timeout',
        'Deadline reached; incomplete response set preserved and room paused.',
      );
    });
    for (const id of cancelled) this.active.get(id)?.abort.abort();
    this.changed(roomId);
  }

  private recover(): void {
    for (const initial of this.store.all()) {
      if (
        !(initial.archivedAt && initial.status !== 'paused') &&
        !initial.jobs.some((j) => j.status === 'running' || j.status === 'queued') &&
        !initial.relays.some((r) => r.status === 'running' || r.status === 'blocked') &&
        !initial.discussions.some((d) => ['running', 'waiting', 'blocked'].includes(d.status))
      )
        continue;
      this.store.mutate(initial.id, (room) => {
        room.status = 'paused';
        for (const job of room.jobs) {
          if (job.status !== 'running') continue;
          job.status = 'interrupted';
          job.error = 'Service stopped during this attempt. Retry explicitly; it was not replayed.';
          job.endedAt = this.timestamp();
          if (job.messageId)
            room.messages.find((m) => m.id === job.messageId)!.status = 'interrupted';
        }
        for (const request of room.requests) this.collect(room, request.id);
        this.audit(
          room,
          'room.recovered',
          'Unfinished room paused for review. Queued work retained; interrupted work requires explicit retry.',
        );
      });
    }
  }

  private cancelJob(room: Room, job: Job): boolean {
    if (job.status !== 'queued' && job.status !== 'running') return false;
    job.status = 'cancelled';
    job.endedAt = this.timestamp();
    if (job.messageId) room.messages.find((m) => m.id === job.messageId)!.status = 'cancelled';
    return true;
  }

  private reserve(room: Room, needed: number): void {
    const reserved =
      room.jobs.filter((j) => j.status === 'queued' && !j.discussionId).length +
      room.requests.filter((r) => r.status === 'collecting' && r.synthesisAgentId).length +
      room.relays
        .filter((r) => r.status === 'running' || r.status === 'blocked')
        .reduce((n, r) => n + r.order.length - r.requestIds.length, 0) +
      room.discussions
        .filter((d) => ['running', 'waiting', 'blocked'].includes(d.status))
        .reduce((n, d) => n + d.maxTurns - d.turnsUsed, 0);
    if (room.turnsUsed + reserved + needed > room.maxTurns)
      throw new AppError(
        409,
        'This request exceeds the remaining turn budget. Create a new room or ask fewer agents.',
      );
  }

  private snapshot(room: Room, messages: ContextSnapshot['messages']): ContextSnapshot {
    if (messages.reduce((n, m) => n + m.body.length, room.objective.length) > 64000)
      throw new AppError(
        413,
        'This thread exceeds the initial context limit. Start a new thread or room; no history was silently removed.',
      );
    return {
      id: this.id(),
      sequence: room.messageSequence ?? room.messages.reduce((n, m) => Math.max(n, m.sequence), 0),
      objective: room.objective,
      agents: structuredClone(room.agents),
      messages: messages.map(({ id, authorId, type, body, authorName }) => {
        const source = room.messages.find((m) => m.id === id);
        return {
          id,
          authorId,
          type,
          body,
          authorName:
            authorName ??
            (authorId === 'human' ? 'Human' : agentLabel(room, authorId, source?.snapshotId)),
        };
      }),
      createdAt: this.timestamp(),
    };
  }

  private job(request: Request, agentId: string, kind: Job['kind'], snapshotId: string): Job {
    return {
      id: this.id(),
      requestId: request.id,
      agentId,
      kind,
      snapshotId,
      status: 'queued',
      attemptId: null,
      messageId: null,
      error: null,
      previousJobId: null,
      createdAt: this.timestamp(),
      startedAt: null,
      endedAt: null,
      ...(request.discussionId ? { discussionId: request.discussionId } : {}),
    };
  }

  private audit(room: Room, type: string, detail: string): void {
    room.events.push({ id: this.id(), type, detail, createdAt: this.timestamp() });
  }
  private nextSequence(room: Room): number {
    room.messageSequence =
      (room.messageSequence ?? room.messages.reduce((n, m) => Math.max(n, m.sequence), 0)) + 1;
    return room.messageSequence;
  }
  private timestamp(): string {
    return this.now().toISOString();
  }
  private changed(roomId: string): void {
    this.emit('changed', roomId);
  }
}
