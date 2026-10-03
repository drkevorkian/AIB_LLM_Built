import {
  agentLabel,
  isAgentActive,
  type ActivityJob,
  type Job,
  type QueueBlocker,
  type Request,
  type ResponsePrerequisite,
  type Room,
  type RoomActivity,
  type ProviderKind,
  type ProviderConcurrency,
  maxConcurrentRequests,
  collectionDeadlineActive,
  collectionTarget,
} from '../shared/contracts.js';

interface RuntimeActivity {
  activeAgentIds: Set<string>;
  checkingAgentIds: Set<string>;
  inUse: number;
  limit: number;
  workspaceInUse: number;
  providerInUse: Map<ProviderKind, number>;
  providerLimits: ProviderConcurrency;
  closed: boolean;
  now: Date;
}

/** Read-only projection of durable order and current scheduler occupancy. */
export function inspectActivity(room: Room, runtime: RuntimeActivity): RoomActivity {
  const requestById = new Map(room.requests.map((request) => [request.id, request]));
  const threadById = new Map(room.threads.map((thread) => [thread.id, thread]));
  const snapshotById = new Map(room.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const jobsByAgent = new Map<string, Job[]>();
  const jobsByRequest = new Map<string, Job[]>();
  for (const job of room.jobs) {
    const agentJobs = jobsByAgent.get(job.agentId) ?? [];
    agentJobs.push(job);
    jobsByAgent.set(job.agentId, agentJobs);
    const requestJobs = jobsByRequest.get(job.requestId) ?? [];
    requestJobs.push(job);
    jobsByRequest.set(job.requestId, requestJobs);
  }
  function describe(job: Job): ActivityJob {
    const request = requestById.get(job.requestId)!;
    const binding = snapshotById.get(job.snapshotId)?.agents.find((a) => a.id === job.agentId);
    return {
      jobId: job.id,
      requestId: request.id,
      threadId: request.threadId,
      threadTitle: threadById.get(request.threadId)?.title ?? null,
      kind: job.kind,
      provider: binding?.provider ?? null,
      model: binding?.model ?? null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      deadlineAt: collectionDeadlineActive(request) ? request.deadlineAt : null,
    };
  }
  function prerequisite(
    request: Request,
    kind: ResponsePrerequisite['kind'],
  ): ResponsePrerequisite {
    const jobs = jobsByRequest.get(request.id) ?? [];
    const respondents: ResponsePrerequisite['respondents'] = request.recipientIds.map(
      (agentId) => ({
        agentId,
        name: agentLabel(room, agentId, request.snapshotId),
        status:
          jobs.findLast((job) => job.agentId === agentId && job.kind === 'answer')?.status ??
          'missing',
      }),
    );
    return {
      requestId: request.id,
      threadId: request.threadId,
      threadTitle: threadById.get(request.threadId)?.title ?? null,
      kind,
      status: request.status as ResponsePrerequisite['status'],
      policy: request.policy,
      received: respondents.filter((respondent) => respondent.status === 'completed').length,
      required: collectionTarget(request),
      deadlineAt: collectionDeadlineActive(request) ? request.deadlineAt : null,
      ...(request.waitingSince ? { waitingSince: request.waitingSince } : {}),
      respondents,
    };
  }
  const prerequisites = new Map<string, ResponsePrerequisite[]>();
  function addPrerequisite(agentId: string, request: Request, kind: ResponsePrerequisite['kind']) {
    if (request.status !== 'collecting' && request.status !== 'unresolved') return;
    const waits = prerequisites.get(agentId) ?? [];
    waits.push(prerequisite(request, kind));
    prerequisites.set(agentId, waits);
  }
  for (const request of room.requests) {
    if (
      request.synthesisAgentId &&
      !(jobsByRequest.get(request.id) ?? []).some((job) => job.kind === 'synthesis')
    )
      addPrerequisite(request.synthesisAgentId, request, 'synthesis');
  }
  for (const discussion of room.discussions) {
    const request = requestById.get(discussion.currentRequestId);
    if (['waiting', 'blocked'].includes(discussion.status) && request?.phase === 'consultation')
      addPrerequisite(discussion.leaderId, request, 'coordinator');
  }
  return {
    roomId: room.id,
    roomRevision: room.revision,
    observedAt: runtime.now.toISOString(),
    capacity: { inUse: runtime.inUse, limit: runtime.limit },
    workspaceCapacity: {
      inUse: runtime.workspaceInUse,
      limit: room.maxConcurrentRequests ?? maxConcurrentRequests,
    },
    providerCapacity: [
      ...new Set([
        ...room.agents.filter((agent) => !agent.removedAt).map((agent) => agent.provider),
        ...room.jobs
          .filter((job) => ['queued', 'running'].includes(job.status))
          .flatMap((job) => {
            const provider = describe(job).provider;
            return provider ? [provider] : [];
          }),
      ]),
    ].map((provider) => ({
      provider,
      inUse: runtime.providerInUse.get(provider) ?? 0,
      limit: runtime.providerLimits[provider],
    })),
    participants: room.agents
      .filter((agent) => !agent.removedAt)
      .map((agent) => {
        const jobs = jobsByAgent.get(agent.id) ?? [];
        const running = jobs.filter((job) => job.status === 'running').map(describe);
        const queued = jobs
          .filter((job) => job.status === 'queued')
          .map((job, index) => {
            const request = requestById.get(job.requestId)!;
            const discussion = room.discussions.find((d) => d.id === job.discussionId);
            const blockers: QueueBlocker[] = [];
            if (room.archivedAt) blockers.push('workspace_archived');
            if (room.status === 'paused') blockers.push('workspace_paused');
            if (room.status === 'stopped') blockers.push('workspace_stopped');
            if (runtime.closed) blockers.push('service_stopping');
            if (!isAgentActive(agent)) blockers.push('participant_inactive');
            if (runtime.activeAgentIds.has(agent.id)) blockers.push('participant_busy');
            if (runtime.checkingAgentIds.has(agent.id)) blockers.push('connection_check');
            if (index > 0) blockers.push('earlier_job');
            if (runtime.inUse >= runtime.limit) blockers.push('service_capacity');
            if (runtime.workspaceInUse >= (room.maxConcurrentRequests ?? maxConcurrentRequests))
              blockers.push('workspace_capacity');
            const provider = describe(job).provider;
            if (
              provider &&
              (runtime.providerInUse.get(provider) ?? 0) >= runtime.providerLimits[provider]
            )
              blockers.push('provider_capacity');
            if (room.turnsUsed >= room.maxTurns) blockers.push('turn_limit');
            if (
              collectionDeadlineActive(request) &&
              Date.parse(request.deadlineAt) <= runtime.now.getTime()
            )
              blockers.push('deadline_elapsed');
            if (discussion && ['completed', 'cancelled'].includes(discussion.status))
              blockers.push('discussion_closed');
            if (discussion && discussion.turnsUsed >= discussion.maxTurns)
              blockers.push('discussion_turn_limit');
            return { ...describe(job), position: index + 1, blockers };
          });
        return {
          agentId: agent.id,
          checkingConnection: runtime.checkingAgentIds.has(agent.id),
          finishing: runtime.activeAgentIds.has(agent.id) && !running.length,
          running,
          queued,
          prerequisites: prerequisites.get(agent.id) ?? [],
        };
      }),
  };
}
