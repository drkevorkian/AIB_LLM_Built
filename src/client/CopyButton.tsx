import { useState } from 'react';

/** Clipboard writes are explicit user actions. Never read the user's clipboard. */
export function CopyButton({
  text,
  label,
  onUnavailable,
}: {
  text: string;
  label: string;
  onUnavailable?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; copied: boolean } | null>(null);
  const current = result?.text === text ? result : null;
  async function copy() {
    const captured = text;
    setBusy(true);
    setResult(null);
    try {
      await navigator.clipboard.writeText(captured);
      setResult({ text: captured, copied: true });
    } catch {
      setResult({ text: captured, copied: false });
      onUnavailable?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="copy-control">
      <button type="button" aria-label={label} disabled={busy || !text} onClick={copy}>
        {busy ? 'Copying…' : current?.copied ? 'Copied' : label}
      </button>
      {current && (
        <span role="status" className={current.copied ? 'copy-status' : 'copy-error'}>
          {current.copied ? 'Text copied.' : 'Clipboard unavailable. Select the text to copy.'}
        </span>
      )}
    </span>
  );
}
