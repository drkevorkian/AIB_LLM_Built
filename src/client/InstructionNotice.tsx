import {
  instructionProvenanceDetails,
  instructionProvenanceLabel,
  type InstructionProvenance,
} from '../shared/instruction-provenance.js';

export function InstructionNotice({
  provenance,
  showCurrent = false,
}: {
  provenance: InstructionProvenance | null;
  showCurrent?: boolean;
}) {
  if (!provenance || (provenance.state === 'current' && !showCurrent)) return null;
  return (
    <div
      className={`instruction-provenance ${provenance.state}`}
      role="note"
      aria-label="Instruction provenance"
    >
      <p>
        <span className={`badge instruction-${provenance.state}`}>
          {instructionProvenanceLabel(provenance)}
        </span>
      </p>
      {instructionProvenanceDetails(provenance).map((detail) => (
        <p key={detail}>{detail}</p>
      ))}
      {provenance.state === 'stale' && (
        <p className="muted">
          The original text and outcome are retained. Retry keeps the original context; ask a new
          question to use current instructions.
        </p>
      )}
    </div>
  );
}
