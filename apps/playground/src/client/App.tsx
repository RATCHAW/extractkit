import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError, ConfigResponse, SerializedResult } from '../shared/api';
import { fetchConfig, runExtract } from './lib/api';
import type { FieldEntry } from './lib/fields';
import { fieldEntries, pathKey } from './lib/fields';
import { Dropzone } from './components/Dropzone';
import { Toolbar } from './components/Toolbar';
import { ResultPanel } from './components/ResultPanel';

// The viewer pulls in pdfjs; load it only once a document is opened.
const DocumentViewer = lazy(() =>
  import('./components/DocumentViewer').then((m) => ({ default: m.DocumentViewer })),
);

export type Phase = 'idle' | 'running' | 'done' | 'error';

interface RunState {
  phase: Phase;
  live: FieldEntry[];
  liveKeys: Set<string>;
  result: SerializedResult | null;
  error: ApiError | null;
}

const IDLE_RUN: RunState = { phase: 'idle', live: [], liveKeys: new Set(), result: null, error: null };

export function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [schemaId, setSchemaId] = useState('');
  const [modelId, setModelId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>(IDLE_RUN);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then((cfg) => {
        setConfig(cfg);
        setSchemaId(cfg.defaults.schema);
        setModelId(cfg.defaults.model ?? '');
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setConfigError(err instanceof Error ? err.message : 'Failed to load configuration.');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (docUrl === null) return;
    return () => URL.revokeObjectURL(docUrl);
  }, [docUrl]);

  const selectFile = useCallback((next: File) => {
    setFile(next);
    setDocUrl(URL.createObjectURL(next));
    setActiveKey(null);
    setRun(IDLE_RUN);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const extract = useCallback(async () => {
    if (file === null || modelId === '') return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveKey(null);
    setRun({ phase: 'running', live: [], liveKeys: new Set(), result: null, error: null });

    try {
      for await (const ev of runExtract({ file, schema: schemaId, model: modelId, signal: controller.signal })) {
        if (ev.type === 'field') {
          const key = pathKey(ev.path);
          setRun((prev) => {
            if (prev.liveKeys.has(key)) return prev;
            const liveKeys = new Set(prev.liveKeys);
            liveKeys.add(key);
            return { ...prev, live: [...prev.live, { key, path: ev.path, field: ev.field }], liveKeys };
          });
        } else if (ev.type === 'result') {
          setRun((prev) => ({ ...prev, phase: 'done', result: ev.result }));
        } else {
          setRun((prev) => ({ ...prev, phase: 'error', error: ev.error }));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setRun(IDLE_RUN);
      } else {
        setRun((prev) => ({
          ...prev,
          phase: 'error',
          error: { name: 'NetworkError', code: null, message: err instanceof Error ? err.message : 'Extraction failed.' },
        }));
      }
    }
  }, [file, modelId, schemaId]);

  const entries = useMemo<FieldEntry[]>(() => {
    if (run.result !== null) return fieldEntries(run.result.fields);
    // A failed run may still carry a partial extraction worth showing.
    if (run.error?.partial !== undefined) return fieldEntries(run.error.partial.fields);
    return run.live;
  }, [run.result, run.error, run.live]);
  // Include fields without model provenance: the PDF viewer can still locate
  // their values in the page text layer. Value-less fields have nothing to find.
  const boxes = useMemo(() => entries.filter((e) => e.field.value !== null), [entries]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">extractkit</span>
          <span className="brand-sub">playground</span>
        </div>
        <p className="tagline">Drag in a document, watch fields extract, hover a field to see where it came from.</p>
        <a className="repo-link" href="https://github.com/RATCHAW/extractkit" target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </header>

      <Toolbar
        config={config}
        configError={configError}
        schemaId={schemaId}
        modelId={modelId}
        hasFile={file !== null}
        phase={run.phase}
        onSchema={setSchemaId}
        onModel={setModelId}
        onFile={selectFile}
        onExtract={() => void extract()}
        onCancel={cancel}
      />

      <main className="workspace">
        <section className="viewer-pane">
          {file !== null && docUrl !== null ? (
            <Suspense fallback={<div className="viewer-message">Loading viewer…</div>}>
              <DocumentViewer
                file={file}
                docUrl={docUrl}
                boxes={boxes}
                activeKey={activeKey}
                onActivate={setActiveKey}
                onFile={selectFile}
              />
            </Suspense>
          ) : (
            <Dropzone onFile={selectFile} />
          )}
        </section>
        <section className="result-pane">
          <ResultPanel
            phase={run.phase}
            live={run.live}
            result={run.result}
            error={run.error}
            hasFile={file !== null}
            activeKey={activeKey}
            onActivate={setActiveKey}
          />
        </section>
      </main>
    </div>
  );
}
