import { useRef, useState, type FormEvent } from 'react';
import type {
  ArtifactContext,
  ArtifactMedia,
  ArtifactPreview,
  ArtifactReference,
  Room,
} from '../shared/contracts.js';
import { artifactMediaSchema, maxArtifactBytes } from '../shared/contracts.js';
import { api, ApiError } from './api.js';
import { CopyButton } from './CopyButton.js';

export function ArtifactSource({
  roomId,
  reference,
}: {
  roomId: string;
  reference: ArtifactReference;
}) {
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function read(download = false) {
    setBusy(true);
    setError('');
    try {
      if (download) {
        const blob = await api.artifactOriginal(roomId, reference.versionId);
        const url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = reference.filename;
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } else setPreview(await api.artifactPreview(roomId, reference.versionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Artifact source unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="artifact-source">
      <p>
        <strong>
          {reference.filename} · v{reference.version}
        </strong>{' '}
        · {reference.mediaType} · {reference.byteSize} original bytes
      </p>
      <p className="source-text">
        <small>
          Version {reference.versionId} · raw-byte SHA-256 {reference.sha256}
        </small>
      </p>
      <div className="artifact-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void read();
          }}
        >
          Preview version {reference.version}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void read(true);
          }}
        >
          Download original version {reference.version}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div
          role="region"
          aria-label={`Artifact preview ${reference.filename} version ${reference.version}`}
        >
          {preview.text !== undefined ? (
            <>
              <pre className="source-text">{preview.text}</pre>
              {preview.truncated ? (
                <p className="notice">
                  Preview omits original text above 16,000 characters. Download the complete
                  original; oversized text cannot be silently supplied to a provider.
                </p>
              ) : (
                <CopyButton
                  text={preview.text}
                  label={`Copy artifact text ${reference.filename} version ${reference.version}`}
                />
              )}
            </>
          ) : preview.entries ? (
            <>
              <p>
                Validated ZIP manifest. Members were checked in bounded memory; no files were
                written or executed.
              </p>
              <ul>
                {preview.entries.map((entry) => (
                  <li key={entry.filename} className="source-text">
                    {entry.filename} · {entry.byteSize} bytes · SHA-256 {entry.sha256}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">
              Metadata preview only. This file is retained without an embedded viewer or image
              decoding. Download the exact original explicitly.
            </p>
          )}
          <p className="muted">
            Original provenance: {reference.versionId} · {reference.sha256}. Previewing/reading
            supplies no provider request.
          </p>
        </div>
      )}
    </div>
  );
}

export function FrozenArtifacts({
  artifacts,
  roomId,
}: {
  artifacts: ArtifactContext[];
  roomId: string;
}) {
  return (
    <details className="frozen-artifacts">
      <summary>Frozen supplied artifact versions · {artifacts.length}</summary>
      <p className="muted">
        Exact human-selected text evidence. Later uploads do not change these versions, instructions
        or routing. Unselected workspace files were not supplied.
      </p>
      {artifacts.map((artifact) => (
        <div key={artifact.versionId}>
          <ArtifactSource roomId={roomId} reference={artifact} />
          <p>Human grant: {artifact.sourceMessageId}</p>
          <details>
            <summary>
              Exact frozen text {artifact.filename} v{artifact.version}
            </summary>
            <pre className="source-text">{artifact.text}</pre>
          </details>
        </div>
      ))}
    </details>
  );
}

export function ArtifactChoice({
  room,
  selected,
  onChange,
  disabled,
  recipientIds,
}: {
  room: Room;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  recipientIds: string[];
}) {
  const versions = room.artifactVersions ?? [];
  if (!versions.length && !selected.length) return null;
  const unavailable = selected.some((id) => !versions.some((version) => version.versionId === id));
  return (
    <details className="artifact-choice">
      <summary>Select text artifact versions · {selected.length}</summary>
      <p className="muted">
        Only explicitly checked full UTF-8 text versions join this question. Up to four, at most
        16,000 characters each. Uploads, previews and prior grants never select newer versions
        automatically. Images/PDF/ZIP/binary provider inclusion is unsupported.
      </p>
      <p className="source-text">
        Recipient bindings:{' '}
        {room.agents
          .filter((agent) => recipientIds.includes(agent.id))
          .map((agent) => `${agent.name}: ${agent.provider} / ${agent.model}`)
          .join('; ')}
        . These selected participants can receive the text through this question and its granted
        synthesis/relay/discussion steps. Each invocation records its exact frozen versions.
      </p>
      {unavailable && (
        <p className="notice">
          A selected artifact version is unavailable. Clear artifact selection and review before
          sending. Your draft is retained.
        </p>
      )}
      <fieldset disabled={disabled}>
        <legend>Explicit full-text provider grants</legend>
        {versions.map((version) => {
          const supported =
            version.previewKind === 'text' && (version.textCharacters ?? 0) <= 16000;
          return (
            <label className="context-check" key={version.versionId}>
              <input
                type="checkbox"
                aria-label={`Include artifact ${version.filename} version ${version.version} ${version.versionId}`}
                checked={selected.includes(version.versionId)}
                disabled={
                  !supported || (!selected.includes(version.versionId) && selected.length >= 4)
                }
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, version.versionId]
                      : selected.filter((id) => id !== version.versionId),
                  )
                }
              />
              <span className="source-text">
                {version.filename} · v{version.version} · {version.sha256}
                {!supported
                  ? ' · original download only; provider inclusion unsupported or too large'
                  : ''}
              </span>
            </label>
          );
        })}
        <button type="button" onClick={() => onChange([])}>
          Clear artifact selection
        </button>
      </fieldset>
    </details>
  );
}

export function Artifacts({ room, onChanged }: { room: Room; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [mediaType, setMediaType] = useState<ArtifactMedia>('text/plain');
  const [artifactId, setArtifactId] = useState('');
  const [revision, setRevision] = useState(room.revision);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const clientId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const versions = room.artifactVersions ?? [];
  const latest = versions.filter(
    (version) =>
      !versions.some(
        (other) => other.artifactId === version.artifactId && other.version > version.version,
      ),
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!file || busy || blocked || room.archivedAt) return;
    setBusy(true);
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > maxArtifactBytes) throw new Error('Artifact version exceeds 512 KiB.');
      let raw = '';
      for (const byte of bytes) raw += String.fromCharCode(byte);
      await api.uploadArtifact(room.id, {
        clientId: clientId.current!,
        expectedRevision: revision,
        ...(artifactId ? { artifactId } : {}),
        filename,
        mediaType,
        base64: btoa(raw),
      });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      clientId.current = null;
      onChanged();
    } catch (cause) {
      setBlocked(true);
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : 'The artifact may have been saved. Refresh and inspect versions before another upload.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="artifact-panel">
      <summary>Workspace artifacts · {versions.length} retained versions</summary>
      <div className="artifact-panel-content">
        <p className="muted">
          Retain original bytes with immutable hashes and versions. Maximum 512 KiB each, 40
          versions and 8 MiB per workspace. Upload/preview/download invokes no provider and consumes
          no turn. Only explicitly selected supported text enters a question.
        </p>
        <form
          className="room-form artifact-form"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <fieldset disabled={busy || blocked || !!room.archivedAt}>
            <label>
              Artifact file
              <input
                type="file"
                ref={fileInput}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  if (next && next.size > maxArtifactBytes) {
                    setError('Artifact version exceeds 512 KiB.');
                    setFile(null);
                    return;
                  }
                  setFile(next);
                  setFilename(next?.name ?? '');
                  setRevision(room.revision);
                  setError('');
                  clientId.current = crypto.randomUUID();
                  const parsed = artifactMediaSchema.safeParse(next?.type);
                  setMediaType(
                    parsed.success
                      ? parsed.data
                      : /\.md$/i.test(next?.name ?? '')
                        ? 'text/markdown'
                        : /\.(txt|log|csv|js|ts|tsx|jsx|py|css|sh|html|svg)$/i.test(
                              next?.name ?? '',
                            )
                          ? 'text/plain'
                          : 'application/octet-stream',
                  );
                }}
              />
            </label>
            <label>
              Original filename
              <input
                required
                maxLength={120}
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
            </label>
            <label>
              Artifact format
              <select
                value={mediaType}
                onChange={(event) => {
                  const parsed = artifactMediaSchema.safeParse(event.target.value);
                  if (parsed.success) setMediaType(parsed.data);
                }}
              >
                {artifactMediaSchema.options.map((media) => (
                  <option key={media} value={media}>
                    {media}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Artifact version target
              <select value={artifactId} onChange={(event) => setArtifactId(event.target.value)}>
                <option value="">New artifact</option>
                {latest.map((version) => (
                  <option key={version.artifactId} value={version.artifactId}>
                    {version.filename} · next version after {version.version}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Reviewed workspace revision {revision}. A new version never overwrites existing bytes
              or changes submitted requests.
            </p>
            <button className="primary" disabled={!file}>
              {busy ? 'Uploading…' : 'Upload artifact version'}
            </button>
          </fieldset>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {blocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .room(room.id)
                  .then((current) => {
                    const saved = current.artifactVersions?.some(
                      (version) => version.clientId === clientId.current,
                    );
                    if (saved) {
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                      clientId.current = null;
                    } else {
                      setRevision(current.revision);
                      clientId.current = crypto.randomUUID();
                      if (
                        artifactId &&
                        !current.artifactVersions?.some(
                          (version) => version.artifactId === artifactId,
                        )
                      )
                        setArtifactId('');
                    }
                    setBlocked(false);
                    setError('');
                    onChanged();
                  })
                  .catch(() =>
                    setError('Artifact review could not be refreshed. Try Refresh again.'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Refresh artifact review
            </button>
          )}
          {file && !blocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = '';
                clientId.current = null;
                setError('');
              }}
            >
              Cancel upload
            </button>
          )}
        </form>
        {!!room.archivedAt && (
          <p className="notice">
            Archived artifact versions are read-only. Originals and previews remain available.
          </p>
        )}
        {versions.map((version) => (
          <details
            className="artifact-version"
            key={version.versionId}
            data-version-id={version.versionId}
          >
            <summary>
              {version.filename} · v{version.version} · {version.byteSize} bytes
            </summary>
            <ArtifactSource roomId={room.id} reference={version} />
          </details>
        ))}
      </div>
    </details>
  );
}
