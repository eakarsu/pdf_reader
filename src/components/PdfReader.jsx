import { useEffect, useRef, useState } from 'react';
import {
  PDF_LIMITS,
  processPdfFile,
  serializePdfResult,
} from '../pdf/pdfProcessing';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function downloadName(fileName) {
  const base = String(fileName || 'document')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return `${base || 'document'}.extracted.json`;
}

export default function PdfReader() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ currentPage: 0, totalPages: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const cancelRequested = useRef(false);
  const inputRef = useRef(null);

  useEffect(
    () => () => {
      cancelRequested.current = true;
    },
    [],
  );

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    cancelRequested.current = false;
    setFile(nextFile);
    setStatus(nextFile ? 'ready' : 'idle');
    setProgress({ currentPage: 0, totalPages: 0 });
    setResult(null);
    setError('');
  }

  function clearFile() {
    cancelRequested.current = true;
    if (inputRef.current) inputRef.current.value = '';
    setFile(null);
    setStatus('idle');
    setProgress({ currentPage: 0, totalPages: 0 });
    setResult(null);
    setError('');
  }

  async function handleProcess() {
    if (!file || status === 'processing') return;

    cancelRequested.current = false;
    setStatus('processing');
    setProgress({ currentPage: 0, totalPages: 0 });
    setResult(null);
    setError('');

    try {
      const { loadPdfDocument } = await import('../pdf/pdfJsAdapter');
      const extracted = await processPdfFile(file, {
        loadDocument: loadPdfDocument,
        shouldCancel: () => cancelRequested.current,
        onProgress: setProgress,
      });

      if (cancelRequested.current) return;
      setResult(extracted);
      setStatus('complete');
    } catch (processingError) {
      if (processingError?.code === 'cancelled') {
        setStatus('ready');
        setError('Processing was cancelled. No output was retained.');
        return;
      }

      setStatus('error');
      setError(processingError?.message || 'The PDF could not be processed locally.');
    }
  }

  function cancelProcessing() {
    cancelRequested.current = true;
  }

  function downloadJson() {
    if (!result) return;

    const blob = new Blob([serializePdfResult(result)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName(result.source.file_name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const processing = status === 'processing';
  const hasPageWarnings = result && (result.summary.needs_ocr_pages || result.summary.failed_pages);

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Private by design</p>
        <h1>Local PDF Reader</h1>
        <p className="hero-copy">
          Extract selectable text into page-level JSON. Your PDF stays in this browser and is
          never uploaded.
        </p>
      </header>

      <section className="panel upload-panel" aria-labelledby="choose-heading">
        <div>
          <h2 id="choose-heading">Choose a document</h2>
          <p id="privacy-boundary" className="muted">
            PDF only · maximum {PDF_LIMITS.maxBytes / 1024 / 1024} MiB · maximum{' '}
            {PDF_LIMITS.maxPages} pages · no OCR or password-protected files
          </p>
        </div>

        <label className="file-picker">
          <span>Select PDF</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby="privacy-boundary"
            onChange={handleFileChange}
            disabled={processing}
          />
        </label>

        {file && (
          <div className="file-card" aria-label="Selected document">
            <div>
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)}</span>
            </div>
            <button className="button button-quiet" type="button" onClick={clearFile} disabled={processing}>
              Remove
            </button>
          </div>
        )}

        <div className="actions">
          <button
            className="button button-primary"
            type="button"
            onClick={handleProcess}
            disabled={!file || processing}
          >
            {processing ? 'Processing locally…' : 'Extract text'}
          </button>
          {processing && (
            <button className="button button-danger" type="button" onClick={cancelProcessing}>
              Cancel
            </button>
          )}
        </div>

        {processing && (
          <div className="progress-block" aria-live="polite">
            <progress
              value={progress.currentPage}
              max={Math.max(progress.totalPages, 1)}
              aria-label="PDF extraction progress"
            />
            <span>
              {progress.totalPages
                ? `Processed page ${progress.currentPage} of ${progress.totalPages}`
                : 'Validating document…'}
            </span>
          </div>
        )}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="panel results" aria-labelledby="results-heading">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Validated output</p>
              <h2 id="results-heading">Extraction complete</h2>
            </div>
            <button className="button button-primary" type="button" onClick={downloadJson}>
              Download JSON
            </button>
          </div>

          <dl className="summary-grid">
            <div>
              <dt>Total pages</dt>
              <dd>{result.page_count}</dd>
            </div>
            <div>
              <dt>Text extracted</dt>
              <dd>{result.summary.extracted_pages}</dd>
            </div>
            <div>
              <dt>Needs OCR</dt>
              <dd>{result.summary.needs_ocr_pages}</dd>
            </div>
            <div>
              <dt>Failed pages</dt>
              <dd>{result.summary.failed_pages}</dd>
            </div>
          </dl>

          {hasPageWarnings ? (
            <p className="notice notice-warning" role="status">
              Some pages have no selectable text or could not be read. The JSON identifies them;
              this application never guesses missing content.
            </p>
          ) : (
            <p className="notice notice-success" role="status">
              Every page produced selectable text.
            </p>
          )}

          <div className="document-id">
            <span>Document ID</span>
            <code>{result.document_id}</code>
          </div>

          <div className="page-list">
            {result.pages.map((page) => (
              <details key={page.page_number} className="page-result">
                <summary>
                  <span>Page {page.page_number}</span>
                  <span className={`status status-${page.extraction_status}`}>
                    {page.extraction_status.replace('_', ' ')}
                  </span>
                </summary>
                {page.text ? (
                  <pre>{page.text}</pre>
                ) : (
                  <p className="muted">
                    {page.extraction_status === 'needs_ocr'
                      ? 'No selectable text was found. Use a reviewed OCR workflow if this content is required.'
                      : 'This page could not be extracted. The other pages remain independently traceable.'}
                  </p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}

      <footer>
        <p>
          Files and extracted text exist only in browser memory until you leave or refresh. A
          downloaded JSON file contains all extracted text; review it before sharing.
        </p>
      </footer>
    </main>
  );
}
