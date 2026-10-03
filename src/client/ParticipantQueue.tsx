import { useEffect, useState } from 'react';
import { api } from './api.js';
import type {
  ActivityJob,
  ParticipantActivity,
  QueueBlocker,
  Room,
  RoomActivity,
} from '../shared/contracts.js';

const blockerLabels: Record<QueueBlocker, string> = {
  workspace_archived: 'Workspace is archived',
  workspace_paused: 'Workspace is paused',
  workspace_stopped: 'Workspace is stopped',
  service_stopping: 'Service is shutting down',
  participant_inactive: 'Participant is inactive',
  participant_busy: 'Participant has an active request',
  connection_check: 'Participant is testing its connection',
  earlier_job: 'Earlier entry in this participant’s queue',
  service_capacity: 'All shared generation slots are occupied',
  workspace_capacity: 'Workspace request limit is full',
  provider_capacity: 'Provider request limit is full',
  turn_limit: 'Workspace turn limit is reached',
  deadline_elapsed: 'Response deadline has elapsed; cancellation is pending',
  discussion_closed: 'Discussion has ended; cancellation is pending',
  discussion_turn_limit: 'Discussion turn allowance is exhausted',
};
const kindLabels: Record<ActivityJob['kind'], string> = {
  answer: 'Answer',
  synthesis: 'Synthesis',
  decision: 'Coordinator decision',
};
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function useRoomActivity(room: Room | null, tick: number) {
  const [activity, setActivity] = useState<RoomActivity | null>(null);
  const [error, setError] = useState(false);
  const roomId = room?.id;
  const revision = room?.revision;
  useEffect(() => {
    setActivity(null);
    setError(false);
  }, [roomId]);
  useEffect(() => {
    if (!roomId) return;
    const abort = new AbortController();
    setError(false);
    void api
      .activity(roomId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted && next.roomId === roomId) setActivity(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setActivity(null);
          setError(true);
        }
      });
    return () => abort.abort();
  }, [roomId, revision, tick]);
  return {
    activity:
      activity && activity.roomId === roomId && activity.roomRevision === revision
        ? activity
        : null,
    error,
  };
}

export function ParticipantQueue({
  name,
  activity,
  participant,
  error,
  connected,
  onRefresh,
  onThread,
}: {
  name: string;
  activity: RoomActivity | null;
  participant: ParticipantActivity | undefined;
  error: boolean;
  connected: boolean;
  onRefresh: () => void;
  onThread: (id: string) => void;
}) {
  function source(job: Pick<ActivityJob, 'threadId' | 'threadTitle'>) {
    return job.threadTitle !== null ? (
      <button className="queue-thread" onClick={() => onThread(job.threadId)}>
        Open thread: {job.threadTitle}
      </button>
    ) : (
      <span>Source thread is unavailable</span>
    );
  }
  function jobDetails(job: ActivityJob) {
    const capacity = activity?.providerCapacity.find((entry) => entry.provider === job.provider);
    return (
      <>
        {source(job)}
        <small>
          {job.provider && job.model
            ? `${job.provider} / ${job.model}`
            : 'Recorded binding unavailable'}
        </small>
        {capacity && (
          <small>
            {capacity.inUse} / {capacity.limit} provider slots occupied
          </small>
        )}
        <small>
          Queued {time(job.createdAt)}
          {job.startedAt ? ` · Started ${time(job.startedAt)}` : ''}
        </small>
        {job.deadlineAt && <small>Response deadline {time(job.deadlineAt)}</small>}
      </>
    );
  }
  return (
    <details className="participant-queue">
      <summary>Inspect queue for {name}</summary>
      <div className="queue-details">
        {activity && participant ? (
          <>
            <p className="queue-observation">
              Observed {time(activity.observedAt)} · {activity.capacity.inUse} /{' '}
              {activity.capacity.limit} shared slots occupied
              {' · '}
              {activity.workspaceCapacity.inUse} / {activity.workspaceCapacity.limit} workspace
              slots occupied
            </p>
            {!connected && (
              <p className="queue-warning">
                Updates disconnected. These are the last observed details.
              </p>
            )}
            {participant.checkingConnection && (
              <p>
                Connection check in progress. It uses a shared slot and holds this participant’s
                queue.
              </p>
            )}
            {participant.finishing && (
              <p>Finishing request cleanup. This participant’s slot is still occupied.</p>
            )}
            {participant.running.map((job) => (
              <div className="queue-entry" key={job.jobId}>
                <strong>Running · {kindLabels[job.kind]}</strong>
                {jobDetails(job)}
              </div>
            ))}
            <h3>Queued generations ({participant.queued.length})</h3>
            {participant.queued.length ? (
              <ol className="queue-list">
                {participant.queued.map((job) => (
                  <li className="queue-entry" key={job.jobId}>
                    <strong>
                      #{job.position} · {kindLabels[job.kind]}
                    </strong>
                    {jobDetails(job)}
                    <p className="queue-reason">
                      {job.blockers.length
                        ? job.blockers.map((reason) => blockerLabels[reason]).join(' · ')
                        : 'Ready for scheduler review at this observation'}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No queued generations.</p>
            )}
            {participant.prerequisites.length > 0 && (
              <>
                <h3>Response prerequisites</h3>
                {participant.prerequisites.map((wait) => (
                  <div className="queue-entry" key={`${wait.kind}-${wait.requestId}`}>
                    <strong>
                      {wait.kind === 'synthesis' ? 'Synthesis' : 'Coordinator continuation'} ·{' '}
                      {wait.status === 'unresolved'
                        ? 'Unresolved responses'
                        : 'Waiting for answers'}
                    </strong>
                    {source(wait)}
                    <p>
                      {wait.received} / {wait.required} required completed answers · {wait.policy}
                    </p>
                    <ul className="queue-respondents">
                      {wait.respondents.map((respondent) => (
                        <li key={respondent.agentId}>
                          {respondent.name}: {respondent.status}
                        </li>
                      ))}
                    </ul>
                    <small>
                      This continuation has not been queued.
                      {wait.status === 'unresolved'
                        ? ' Review the failed or interrupted attempts before explicitly retrying.'
                        : ''}
                    </small>
                    {wait.deadlineAt && (
                      <small>
                        Response deadline {time(wait.deadlineAt)}; deadlines continue while paused.
                      </small>
                    )}
                  </div>
                ))}
              </>
            )}
            <p className="queue-observation">
              Order is per participant. Slots are shared across workspaces; readiness does not
              promise a start time.
            </p>
          </>
        ) : (
          <p>
            {error
              ? 'Queue details are unavailable. Refresh to try again.'
              : 'Refreshing queue details…'}
          </p>
        )}
        <button className="quiet queue-refresh" onClick={onRefresh}>
          Refresh queue details for {name}
        </button>
      </div>
    </details>
  );
}
