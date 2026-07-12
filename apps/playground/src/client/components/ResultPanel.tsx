import type { ApiError, SerializedResult } from '../../shared/api';
import type { Phase } from '../App';
import type { AnyField, FieldEntry } from '../lib/fields';
import { formatPath, formatValue, isField, leafLabel, pathKey } from '../lib/fields';
import type { FieldPath } from '@ratchaw/extractkit';

interface ResultPanelProps {
  phase: Phase;
  live: FieldEntry[];
  result: SerializedResult | null;
  error: ApiError | null;
  hasFile: boolean;
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}

export function ResultPanel(props: ResultPanelProps) {
  const { phase, live, result, error, hasFile, activeKey, onActivate } = props;
  // A failed run may still carry a partial extraction — show it under the error.
  const fields = result !== null ? result.fields : (error?.partial?.fields ?? null);
  const usage = result !== null ? result.usage : (error?.partial?.usage ?? null);

  return (
    <div className="result-panel">
      <div className="result-head">
        <h2>Extraction</h2>
        <StatusPill phase={phase} count={result === null ? live.length : undefined} />
      </div>

      <div className="result-body">
        {error !== null && <ErrorBanner error={error} />}
        {fields !== null && (
          <div className="tree">
            <FieldNode node={fields} path={[]} activeKey={activeKey} onActivate={onActivate} />
          </div>
        )}
        {error === null && fields === null && phase === 'running' && (
          <LiveList entries={live} activeKey={activeKey} onActivate={onActivate} />
        )}
        {error === null && fields === null && phase !== 'running' && <EmptyHint hasFile={hasFile} />}
      </div>

      {usage !== null && <ResultFooter usage={usage} issues={result?.issues ?? []} />}
    </div>
  );
}

function indentStyle(level: number) {
  return { paddingLeft: `${12 + Math.max(0, level) * 14}px` };
}

interface NodeProps {
  node: unknown;
  path: FieldPath;
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}

function FieldNode({ node, path, activeKey, onActivate }: NodeProps) {
  if (node === null) {
    return (
      <div className="tree-row muted" style={indentStyle(path.length - 1)}>
        <span className="tree-key">{leafLabel(path)}</span>
        <span className="tree-value">—</span>
      </div>
    );
  }

  if (isField(node)) {
    const key = pathKey(path);
    return (
      <FieldRow
        label={leafLabel(path)}
        entry={{ key, path, field: node }}
        level={path.length - 1}
        active={activeKey === key}
        onActivate={onActivate}
      />
    );
  }

  if (Array.isArray(node)) {
    return (
      <div className="tree-group">
        <div className="tree-group-label" style={indentStyle(path.length - 1)}>
          {leafLabel(path)} <span className="badge">{node.length}</span>
        </div>
        {node.map((child, i) => (
          <FieldNode key={i} node={child} path={[...path, i]} activeKey={activeKey} onActivate={onActivate} />
        ))}
      </div>
    );
  }

  const entries = Object.entries(node as Record<string, unknown>);
  return (
    <div className="tree-group">
      {path.length > 0 && (
        <div className="tree-group-label" style={indentStyle(path.length - 1)}>
          {leafLabel(path)}
        </div>
      )}
      {entries.map(([key, child]) => (
        <FieldNode key={key} node={child} path={[...path, key]} activeKey={activeKey} onActivate={onActivate} />
      ))}
    </div>
  );
}

function LiveList({
  entries,
  activeKey,
  onActivate,
}: {
  entries: FieldEntry[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="live-empty">
        <span className="spinner" aria-hidden /> Reading the document…
      </div>
    );
  }
  return (
    <div className="tree">
      {entries.map((entry) => (
        <FieldRow
          key={entry.key}
          label={formatPath(entry.path)}
          entry={entry}
          level={0}
          active={activeKey === entry.key}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}

function FieldRow({
  label,
  entry,
  level,
  active,
  onActivate,
}: {
  label: string;
  entry: FieldEntry;
  level: number;
  active: boolean;
  onActivate: (key: string | null) => void;
}) {
  const { field } = entry;
  return (
    <div
      className="tree-row"
      data-active={active}
      style={indentStyle(level)}
      onMouseEnter={() => onActivate(entry.key)}
      onMouseLeave={() => onActivate(null)}
    >
      <span className="tree-key">{label}</span>
      <span className="tree-value">{formatValue(field.value)}</span>
      <Confidence field={field} />
    </div>
  );
}

function Confidence({ field }: { field: AnyField }) {
  const pct = Math.round(field.confidence * 100);
  const tier = field.confidence >= 0.8 ? 'high' : field.confidence >= 0.5 ? 'mid' : 'low';
  const located = field.bbox !== null;
  return (
    <span className="confidence" title={located ? `Confidence ${pct}%` : `Confidence ${pct}% · no source region`}>
      <span className="confidence-bar">
        <span className="confidence-fill" data-tier={tier} style={{ width: `${pct}%` }} />
      </span>
      <span className="confidence-pct">{pct}%</span>
      {!located && (
        <span className="no-source" title="No source region located">
          ⚠
        </span>
      )}
    </span>
  );
}

function StatusPill({ phase, count }: { phase: Phase; count: number | undefined }) {
  if (phase === 'running') {
    return <span className="pill running">{count !== undefined && count > 0 ? `Extracting · ${count}` : 'Extracting…'}</span>;
  }
  if (phase === 'done') return <span className="pill done">Done</span>;
  if (phase === 'error') return <span className="pill error">Error</span>;
  return <span className="pill idle">Idle</span>;
}

function EmptyHint({ hasFile }: { hasFile: boolean }) {
  return (
    <div className="result-empty">
      {hasFile ? 'Press Extract to pull fields from this document.' : 'Upload a document to get started.'}
    </div>
  );
}

function ResultFooter({ usage, issues }: { usage: SerializedResult['usage']; issues: string[] }) {
  return (
    <div className="result-footer">
      <div className="stats">
        <Stat label="Model calls" value={String(usage.modelCalls)} />
        <Stat label="Input tokens" value={usage.inputTokens.toLocaleString()} />
        <Stat label="Output tokens" value={usage.outputTokens.toLocaleString()} />
        <Stat label="Cost" value={usage.costUSD !== null ? formatUSD(usage.costUSD) : '—'} />
        <Stat label="Est. / 1k docs" value={usage.costUSD !== null ? formatUSD(usage.costUSD * 1000) : '—'} />
      </div>
      {issues.length > 0 && (
        <details className="issues">
          <summary>
            {issues.length} provenance {issues.length === 1 ? 'note' : 'notes'}
          </summary>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

const ERROR_TITLES: Record<string, string> = {
  DOCUMENT_UNREADABLE: 'Document unreadable',
  MISSING_REQUIRED_FIELDS: "Some required fields weren't found",
  EXTRACTION_FAILED: 'Extraction failed',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file type',
  MEDIA_TYPE_MISMATCH: 'File type mismatch',
  ENCRYPTED_DOCUMENT: 'Document is encrypted',
  INVALID_DOCUMENT: 'Invalid document',
  SCHEMA_UNSUPPORTED: 'Unsupported schema',
};

function ErrorBanner({ error }: { error: ApiError }) {
  const title = (error.code !== null && ERROR_TITLES[error.code]) || error.name;
  const paths = error.missingPaths ?? [];
  return (
    <div className="error-banner">
      <div className="error-title">{title}</div>
      {/* For missing-fields errors the message just repeats the paths list. */}
      {paths.length === 0 && <div className="error-message">{error.message}</div>}
      {paths.length > 0 && (
        <ul className="error-paths">
          {paths.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      )}
      {error.partial !== undefined && (
        <div className="error-message">Everything that was extracted is shown below.</div>
      )}
    </div>
  );
}

function formatUSD(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
