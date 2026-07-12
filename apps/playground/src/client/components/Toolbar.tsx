import { useRef } from 'react';
import type { ConfigResponse } from '../../shared/api';
import type { Phase } from '../App';
import { ACCEPT_ATTR, pickFile } from '../lib/upload';

interface ToolbarProps {
  config: ConfigResponse | null;
  configError: string | null;
  schemaId: string;
  modelId: string;
  hasFile: boolean;
  phase: Phase;
  onSchema: (id: string) => void;
  onModel: (id: string) => void;
  onFile: (file: File) => void;
  onExtract: () => void;
  onCancel: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { config, configError, schemaId, modelId, hasFile, phase } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const running = phase === 'running';
  const noModels = config !== null && config.models.length === 0;
  const canExtract = hasFile && modelId !== '' && !running;

  return (
    <div className="toolbar">
      <label className="field">
        <span className="field-label">Schema</span>
        <select
          value={schemaId}
          disabled={config === null || running}
          onChange={(e) => props.onSchema(e.target.value)}
        >
          {config?.schemas.map((schema) => (
            <option key={schema.id} value={schema.id}>
              {schema.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Model</span>
        <select
          value={modelId}
          disabled={config === null || noModels || running}
          onChange={(e) => props.onModel(e.target.value)}
        >
          {noModels && <option value="">No models available</option>}
          {config?.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="toolbar-actions">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const result = pickFile(e.target.files);
            if ('file' in result) props.onFile(result.file);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn ghost" onClick={() => inputRef.current?.click()} disabled={running}>
          {hasFile ? 'Replace' : 'Upload'}
        </button>
        {running ? (
          <button type="button" className="btn" onClick={props.onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={props.onExtract} disabled={!canExtract}>
            Extract
          </button>
        )}
      </div>

      {configError !== null && <p className="toolbar-note error">{configError}</p>}
      {noModels && configError === null && (
        <p className="toolbar-note">
          Set <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, or{' '}
          <code>GOOGLE_GENERATIVE_AI_API_KEY</code> on the server to enable extraction.
        </p>
      )}
    </div>
  );
}
