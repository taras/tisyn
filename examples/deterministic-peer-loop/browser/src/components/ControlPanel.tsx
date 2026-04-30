import type { ControlPatch, LoopControl, PeerSpeaker } from "../useChat.ts";

export interface ControlPanelProps {
  control: LoopControl;
  disabled?: boolean;
  onUpdate: (patch: ControlPatch) => void;
}

export function ControlPanel({ control, disabled, onUpdate }: ControlPanelProps) {
  const override: "auto" | PeerSpeaker = control.nextSpeakerOverride ?? "auto";

  return (
    <section className="control-panel" aria-label="Operator control">
      <h2>Control</h2>

      <div className="control-row">
        <label>
          <input
            type="checkbox"
            disabled={disabled}
            checked={control.paused}
            onChange={(e) => onUpdate({ paused: e.target.checked })}
          />
          Paused
        </label>
      </div>

      <div className="control-row">
        <button
          type="button"
          disabled={disabled || control.stopRequested}
          onClick={() => onUpdate({ stopRequested: true })}
        >
          Stop loop
        </button>
        {control.stopRequested ? <span className="badge">stop requested</span> : null}
      </div>

      <div className="control-row">
        <label htmlFor="next-speaker-override">Next speaker override</label>
        <select
          id="next-speaker-override"
          disabled={disabled}
          value={override}
          onChange={(e) => {
            const v = e.target.value as "auto" | PeerSpeaker;
            onUpdate({ nextSpeakerOverride: v === "auto" ? null : v });
          }}
        >
          <option value="auto">auto</option>
          <option value="opus">opus</option>
          <option value="gpt">gpt</option>
        </select>
      </div>

      <dl className="control-readout">
        <dt>paused</dt>
        <dd>{String(control.paused)}</dd>
        <dt>stopRequested</dt>
        <dd>{String(control.stopRequested)}</dd>
        <dt>nextSpeakerOverride</dt>
        <dd>{control.nextSpeakerOverride ?? "—"}</dd>
      </dl>
    </section>
  );
}
