import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { GlobalWorkerOptions, Util, getDocument } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BBox as BBoxRect } from 'extractkit';
import type { FieldEntry } from '../lib/fields';
import { formatPath, formatValue } from '../lib/fields';
import { bboxToStyle } from '../lib/geometry';
import type { TextSpan } from '../lib/snap';
import { locateField } from '../lib/snap';
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
        <ImagePage src={docUrl} boxes={boxes} activeKey={activeKey} onActivate={onActivate} />
      )}
    </div>
  );
}

/** A field placed on a specific page, with the bbox to draw. */
interface PlacedBox {
  entry: FieldEntry;
  bbox: BBoxRect;
}

interface OverlayProps {
  boxes: FieldEntry[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}

function ImagePage({ src, boxes, activeKey, onActivate }: { src: string } & OverlayProps) {
  // Images have no text layer to snap to; draw the model's own provenance.
  const placed = useMemo(
    () =>
      boxes
        .filter((box) => box.field.bbox !== null && (box.field.page ?? 0) === 0)
        .map((box) => ({ entry: box, bbox: box.field.bbox! })),
    [boxes],
  );
  return (
    <div className="page-stack">
      <div className="page">
        <img className="page-image" src={src} alt="Uploaded document" />
        <BoxLayer placed={placed} activeKey={activeKey} onActivate={onActivate} />
      </div>
    </div>
  );
}

/** Positioned text runs of a page, normalized 0–1 with a top-left origin. */
async function pageTextSpans(page: PDFPageProxy): Promise<TextSpan[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const spans: TextSpan[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const tx = Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    spans.push({
      text: item.str,
      x0: tx[4] / viewport.width,
      y0: (tx[5] - fontHeight) / viewport.height,
      x1: (tx[4] + item.width * viewport.scale) / viewport.width,
      y1: tx[5] / viewport.height,
    });
  }
  return spans;
}

function PdfView({ file, boxes, activeKey, onActivate }: { file: File } & OverlayProps) {
  const [pages, setPages] = useState<{ page: PDFPageProxy; spans: TextSpan[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Place every field: snap to the page text layer, rescuing fields whose
  // model-reported bbox or page is missing or wrong.
  const placedByPage = useMemo<PlacedBox[][]>(() => {
    const spansByPage = pages.map((p) => p.spans);
    const byPage: PlacedBox[][] = pages.map(() => []);
    for (const entry of boxes) {
      const located = locateField(entry.field.value, entry.field.page, entry.field.bbox, spansByPage);
      if (located !== null) byPage[located.page]!.push({ entry, bbox: located.bbox });
    }
    return byPage;
  }, [boxes, pages]);

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
          Array.from({ length: doc.numPages }, async (_, i) => {
            const page = await doc.getPage(i + 1);
            return { page, spans: await pageTextSpans(page) };
          }),
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
      {pages.map(({ page }, index) => (
        <div className="page" key={index}>
          <PdfCanvas page={page} />
          <BoxLayer placed={placedByPage[index]!} activeKey={activeKey} onActivate={onActivate} />
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

function BoxLayer({
  placed,
  activeKey,
  onActivate,
}: {
  placed: PlacedBox[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}) {
  return (
    <div className="box-layer">
      {placed.map(({ entry, bbox }) => (
        <BBox
          key={entry.key}
          entry={entry}
          bbox={bbox}
          active={activeKey === entry.key}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}

function BBox({
  entry,
  bbox,
  active,
  onActivate,
}: {
  entry: FieldEntry;
  bbox: BBoxRect;
  active: boolean;
  onActivate: (key: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

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
