import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ACCEPT_ATTR, pickFile } from '../lib/upload';

interface DropzoneProps {
  onFile: (file: File) => void;
}

export function Dropzone({ onFile }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (files: FileList | null) => {
      const result = pickFile(files);
      if ('file' in result) {
        setError(null);
        onFile(result.file);
      } else {
        setError(result.error);
      }
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      accept(e.dataTransfer.files);
    },
    [accept],
  );

  return (
    <div
      className="dropzone"
      data-dragging={dragging}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => accept(e.target.files)}
      />
      <div className="dropzone-icon" aria-hidden>
        ⤓
      </div>
      <p className="dropzone-title">Drop a document here</p>
      <p className="dropzone-hint">or click to browse — PDF, PNG, JPEG, or WebP, up to 15 MB</p>
      {error !== null && <p className="dropzone-error">{error}</p>}
    </div>
  );
}
