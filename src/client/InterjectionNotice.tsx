import type { Message } from '../shared/contracts.js';

export function InterjectionNotice({ message }: { message: Message }) {
  const record =
    message.authorId === 'human' && message.type === 'interjection'
      ? message.interjection
      : undefined;
  if (!record) return null;
  return (
    <div className="notice" role="note" aria-label="Human interjection record">
      <p>
        {record.priority === 'urgent' ? 'Urgent' : 'Normal'} priority ·{' '}
        {record.dispatchPolicy === 'pause'
          ? 'New dispatches paused when recorded.'
          : 'Recorded without changing dispatch.'}
      </p>
      <p>
        Active work and queued requests keep their original context. This message creates no
        response obligations. Ask a new question to request a response.
      </p>
      <p>
        Work observed across the workspace: {record.queuedJobIds.length} queued ·{' '}
        {record.runningJobIds.length} active. These counts describe the recording time.
      </p>
    </div>
  );
}
