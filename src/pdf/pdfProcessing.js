export const PDF_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxPages: 100,
});

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PAGE_STATUSES = new Set(['extracted', 'needs_ocr', 'failed']);

export class PdfProcessingError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PdfProcessingError';
    this.code = code;
  }
}

function cleanFileName(name) {
  const cleaned = String(name || 'document.pdf')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);

  return cleaned || 'document.pdf';
}

function hasPdfSignature(bytes) {
  return PDF_SIGNATURE.every((value, index) => bytes[index] === value);
}

export async function validatePdfFile(file, limits = PDF_LIMITS) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new PdfProcessingError('missing_file', 'Choose a PDF file to continue.');
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new PdfProcessingError('empty_file', 'The selected file is empty.');
  }

  if (file.size > limits.maxBytes) {
    throw new PdfProcessingError(
      'file_too_large',
      `The PDF exceeds the ${Math.floor(limits.maxBytes / 1024 / 1024)} MiB limit.`,
    );
  }

  if (file.type && file.type.toLowerCase() !== 'application/pdf') {
    throw new PdfProcessingError('invalid_type', 'The selected file is not identified as a PDF.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < PDF_SIGNATURE.length || !hasPdfSignature(bytes)) {
    throw new PdfProcessingError(
      'invalid_signature',
      'The file does not have a valid PDF signature.',
    );
  }

  return bytes;
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new PdfProcessingError(
      'unsupported_browser',
      'This browser does not provide the cryptography required to identify the document.',
    );
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function joinTextItems(items = []) {
  let text = '';

  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;

    const value = item.str;
    const needsSpace =
      text.length > 0 &&
      !/[\s\n]$/.test(text) &&
      value.length > 0 &&
      !/^\s/.test(value);

    if (needsSpace) text += ' ';
    text += value;
    if (item.hasEOL && !text.endsWith('\n')) text += '\n';
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMetadata(info = {}) {
  const fields = [
    ['title', 'Title'],
    ['author', 'Author'],
    ['subject', 'Subject'],
    ['creator', 'Creator'],
    ['producer', 'Producer'],
    ['creation_date', 'CreationDate'],
    ['modification_date', 'ModDate'],
  ];

  return Object.fromEntries(
    fields.flatMap(([outputKey, inputKey]) => {
      const value = info[inputKey];
      return typeof value === 'string' && value.trim()
        ? [[outputKey, value.trim().slice(0, 2_000)]]
        : [];
    }),
  );
}

function pageDimensions(page) {
  if (typeof page?.getViewport !== 'function') return null;

  const viewport = page.getViewport({ scale: 1 });
  return {
    width_points: Math.round(viewport.width * 1_000) / 1_000,
    height_points: Math.round(viewport.height * 1_000) / 1_000,
    rotation_degrees: viewport.rotation || 0,
  };
}

function mapPdfError(error) {
  if (error instanceof PdfProcessingError) return error;

  if (error?.name === 'PasswordException') {
    return new PdfProcessingError(
      'encrypted_pdf',
      'Password-protected PDFs are not supported. Decrypt a copy before processing.',
      error,
    );
  }

  if (['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException'].includes(error?.name)) {
    return new PdfProcessingError(
      'malformed_pdf',
      'The PDF is malformed, incomplete, or otherwise unreadable.',
      error,
    );
  }

  return new PdfProcessingError(
    'processing_failed',
    'The PDF could not be processed locally.',
    error,
  );
}

export function validateExtractionResult(result) {
  const sourceHash = result?.source?.sha256;
  const summary = result?.summary;
  const validSummary =
    summary &&
    ['extracted_pages', 'needs_ocr_pages', 'failed_pages'].every(
      (key) => Number.isInteger(summary[key]) && summary[key] >= 0,
    );
  const valid =
    result?.schema_version === '1.0.0' &&
    typeof result?.document_id === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(result.document_id) &&
    result.document_id === `sha256:${sourceHash}` &&
    result?.source?.media_type === 'application/pdf' &&
    typeof result?.source?.file_name === 'string' &&
    result.source.file_name.length > 0 &&
    Number.isInteger(result?.source?.byte_size) &&
    result.source.byte_size > 0 &&
    validSummary &&
    Number.isInteger(result?.page_count) &&
    result.page_count >= 1 &&
    Array.isArray(result?.pages) &&
    result.pages.length === result.page_count &&
    result.pages.every(
      (page, index) =>
        page.page_number === index + 1 &&
        page.source_document_id === result.document_id &&
        PAGE_STATUSES.has(page.extraction_status) &&
        typeof page.text === 'string' &&
        page.character_count === page.text.length &&
        (page.dimensions === null ||
          (Number.isFinite(page.dimensions?.width_points) &&
            page.dimensions.width_points > 0 &&
            Number.isFinite(page.dimensions?.height_points) &&
            page.dimensions.height_points > 0 &&
            Number.isFinite(page.dimensions?.rotation_degrees))) &&
        (page.extraction_status === 'extracted' ? page.text.length > 0 : page.text.length === 0) &&
        (page.extraction_status === 'failed'
          ? page.error_code === 'page_extraction_failed'
          : page.error_code === null),
    );

  if (!valid) {
    throw new PdfProcessingError(
      'invalid_output',
      'The extracted output failed deterministic validation and was not exported.',
    );
  }

  const statusCounts = result.pages.reduce(
    (counts, page) => ({ ...counts, [page.extraction_status]: counts[page.extraction_status] + 1 }),
    { extracted: 0, needs_ocr: 0, failed: 0 },
  );

  if (
    statusCounts.extracted !== summary.extracted_pages ||
    statusCounts.needs_ocr !== summary.needs_ocr_pages ||
    statusCounts.failed !== summary.failed_pages
  ) {
    throw new PdfProcessingError(
      'invalid_output',
      'The extracted output summary is inconsistent and was not exported.',
    );
  }

  return result;
}

export async function processPdfFile(
  file,
  {
    loadDocument,
    limits = PDF_LIMITS,
    onProgress = () => {},
    shouldCancel = () => false,
    hashBytes = sha256Hex,
  } = {},
) {
  let loadingTask;

  try {
    if (typeof loadDocument !== 'function') {
      throw new PdfProcessingError('configuration_error', 'The local PDF engine is unavailable.');
    }

    const bytes = await validatePdfFile(file, limits);
    if (shouldCancel()) throw new PdfProcessingError('cancelled', 'Processing was cancelled.');

    const contentHash = await hashBytes(bytes);
    const documentId = `sha256:${contentHash}`;

    loadingTask = loadDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      stopAtErrors: true,
      useWorkerFetch: false,
    });
    const pdf = await loadingTask.promise;

    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
      throw new PdfProcessingError('malformed_pdf', 'The PDF does not contain any readable pages.');
    }

    if (pdf.numPages > limits.maxPages) {
      throw new PdfProcessingError(
        'too_many_pages',
        `The PDF exceeds the ${limits.maxPages}-page processing limit.`,
      );
    }

    let metadata = {};
    try {
      const rawMetadata = await pdf.getMetadata?.();
      metadata = normalizeMetadata(rawMetadata?.info);
    } catch {
      metadata = {};
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (shouldCancel()) throw new PdfProcessingError('cancelled', 'Processing was cancelled.');

      let page;
      try {
        page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent({
          disableNormalization: false,
          includeMarkedContent: false,
        });
        const text = joinTextItems(textContent?.items);

        pages.push({
          page_number: pageNumber,
          source_document_id: documentId,
          extraction_status: text ? 'extracted' : 'needs_ocr',
          character_count: text.length,
          dimensions: pageDimensions(page),
          text,
          error_code: null,
        });
      } catch {
        pages.push({
          page_number: pageNumber,
          source_document_id: documentId,
          extraction_status: 'failed',
          character_count: 0,
          dimensions: null,
          text: '',
          error_code: 'page_extraction_failed',
        });
      } finally {
        try {
          page?.cleanup?.();
        } catch {
          // PDF.js cleanup failures must not corrupt otherwise validated output.
        }
      }

      onProgress({ currentPage: pageNumber, totalPages: pdf.numPages });
    }

    const summary = pages.reduce(
      (counts, page) => {
        counts[`${page.extraction_status}_pages`] += 1;
        return counts;
      },
      { extracted_pages: 0, needs_ocr_pages: 0, failed_pages: 0 },
    );

    return validateExtractionResult({
      schema_version: '1.0.0',
      document_id: documentId,
      source: {
        file_name: cleanFileName(file.name),
        media_type: 'application/pdf',
        byte_size: file.size,
        sha256: contentHash,
      },
      page_count: pdf.numPages,
      metadata,
      summary,
      pages,
    });
  } catch (error) {
    throw mapPdfError(error);
  } finally {
    try {
      await loadingTask?.destroy?.();
    } catch {
      // Best-effort cleanup; never replace the primary extraction outcome.
    }
  }
}

export function serializePdfResult(result) {
  validateExtractionResult(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}
