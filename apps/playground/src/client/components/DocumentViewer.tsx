import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FieldEntry } from '../lib/fields';
import { formatPath, formatValue } from '../lib/fields';
import { bboxToStyle } from '../lib/geometry';
import { isPdf, pickFile } from '../lib/upload';

GlobalWorkerOptions.workerSrc = workerSrc;

interface ViewerProps {
  file: File;
  docUrl: string;
  boxes: FieldEntry[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
  onFile: (file: File) => void;
}

export function DocumentViewer(props: ViewerProps) {
  const { file, docUrl, boxes, activeKey, onActivate, onFile } = props;
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const result = pickFile(e.dataTransfer.files);
    if ('file' in result) onFile(result.file);
  };

  return (
    <div
      className="viewer"
      data-dragging={dragging}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {isPdf(file) ? (
        <PdfView file={file} boxes={boxes} activeKey={activeKey} onActivate={onActivate} />
      ) : (
        <div className="page-stack">
          <ImagePage
            src={docUrl}
            pageIndex={0}
            boxes={boxes}
            activeKey={activeKey}
            onActivate={onActivate}
          />
        </div>
      )}
    </div>
  );
}

interface PageBoxProps {
  boxes: FieldEntry[];
  pageIndex: number;
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}

function ImagePage({ src, ...page }: { src: string } & PageBoxProps) {
  return (
    <div className="page">
      <img className="page-image" src={src} alt="Uploaded document" />
      <BoxLayer {...page} />
    </div>
  );
}

function PdfView({ file, boxes, activeKey, onActivate }: { file: File } & Omit<PageBoxProps, 'pageIndex'>) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setPages([]);
    setError(null);
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        loadingTask = getDocument({ data: new Uint8Array(buffer) });
        const doc = await loadingTask.promise;
        const proxies = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        );
        if (cancelled) return;
        setPages(proxies);
      } catch {
        if (!cancelled) setError('This PDF could not be rendered in the browser.');
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask !== null) void loadingTask.destroy();
    };
  }, [file]);

  if (error !== null) return <div className="viewer-message error">{error}</div>;

  return (
    <div className="page-stack">
      {pages.map((page, index) => (
        <div className="page" key={index}>
          <PdfCanvas page={page} />
          <BoxLayer boxes={boxes} pageIndex={index} activeKey={activeKey} onActivate={onActivate} />
        </div>
      ))}
    </div>
  );
}

function PdfCanvas({ page }: { page: PDFPageProxy }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / base.width);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const task = page.render({ canvas, canvasContext: context, viewport });
    task.promise.catch(() => {
      // Cancelled on unmount or superseded render; ignore.
    });
    return () => task.cancel();
  }, [page]);

  return <canvas ref={canvasRef} className="page-canvas" />;
}

function BoxLayer({ boxes, pageIndex, activeKey, onActivate }: PageBoxProps) {
  const onPage = boxes.filter((box) => (box.field.page ?? 0) === pageIndex);
  return (
    <div className="box-layer">
      {onPage.map((box) => (
        <BBox key={box.key} entry={box} active={activeKey === box.key} onActivate={onActivate} />
      ))}
    </div>
  );
}

function BBox({
  entry,
  active,
  onActivate,
}: {
  entry: FieldEntry;
  active: boolean;
  onActivate: (key: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { bbox } = entry.field;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  if (bbox === null) return null;
  return (
    <div
      ref={ref}
      className="bbox"
      data-active={active}
      style={bboxToStyle(bbox)}
      title={`${formatPath(entry.path)} · ${formatValue(entry.field.value)}`}
      onMouseEnter={() => onActivate(entry.key)}
      onMouseLeave={() => onActivate(null)}
    />
  );
}
