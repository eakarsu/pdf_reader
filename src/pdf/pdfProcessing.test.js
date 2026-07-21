import { describe, expect, it, vi } from 'vitest';
import {
  PDF_LIMITS,
  PdfProcessingError,
  joinTextItems,
  processPdfFile,
  serializePdfResult,
  validateExtractionResult,
  validatePdfFile,
} from './pdfProcessing';

function fileFixture(content = '%PDF-1.7\nfixture', overrides = {}) {
  const bytes = new TextEncoder().encode(content);
  return {
    name: 'fixture.pdf',
    type: 'application/pdf',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0),
    ...overrides,
  };
}

function pdfFixture(pageItems, { metadata = {}, failedPage = 0 } = {}) {
  const cleanup = vi.fn();
  const pdf = {
    numPages: pageItems.length,
    getMetadata: vi.fn().mockResolvedValue({ info: metadata }),
    getPage: vi.fn(async (pageNumber) => {
      if (pageNumber === failedPage) throw new Error('synthetic page failure');
      return {
        getTextContent: vi.fn().mockResolvedValue({ items: pageItems[pageNumber - 1] }),
        getViewport: vi.fn().mockReturnValue({ width: 612, height: 792, rotation: 0 }),
        cleanup,
      };
    }),
  };
  const destroy = vi.fn().mockResolvedValue(undefined);

  return {
    cleanup,
    destroy,
    pdf,
    loadDocument: vi.fn(() => ({ promise: Promise.resolve(pdf), destroy })),
  };
}

const fixedHash = vi.fn().mockResolvedValue('a'.repeat(64));

describe('PDF input validation', () => {
  it('accepts bytes with a PDF signature', async () => {
    const bytes = await validatePdfFile(fileFixture());
    expect(new TextDecoder().decode(bytes).startsWith('%PDF-')).toBe(true);
  });

  it('rejects missing, empty, oversized, and mismatched MIME inputs', async () => {
    await expect(validatePdfFile(null)).rejects.toMatchObject({ code: 'missing_file' });
    await expect(validatePdfFile(fileFixture('', { size: 0 }))).rejects.toMatchObject({
      code: 'empty_file',
    });
    await expect(
      validatePdfFile(fileFixture(undefined, { size: PDF_LIMITS.maxBytes + 1 })),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    await expect(validatePdfFile(fileFixture(undefined, { type: 'text/plain' }))).rejects.toMatchObject({
      code: 'invalid_type',
    });
  });

  it('rejects a renamed non-PDF by inspecting its signature', async () => {
    await expect(validatePdfFile(fileFixture('not a pdf'))).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });
});

describe('text normalization', () => {
  it('preserves multilingual text and explicit line endings', () => {
    expect(
      joinTextItems([
        { str: 'Hello', hasEOL: false },
        { str: '世界', hasEOL: true },
        { str: 'مرحبا', hasEOL: false },
      ]),
    ).toBe('Hello 世界\nمرحبا');
  });

  it('ignores malformed items and returns an empty string for scanned pages', () => {
    expect(joinTextItems([null, {}, { str: '' }])).toBe('');
  });
});

describe('deterministic PDF extraction', () => {
  it('extracts page-level provenance, metadata, dimensions, and validated summaries', async () => {
    const fixture = pdfFixture(
      [
        [
          { str: 'Cabinet', hasEOL: false },
          { str: 'width: 24 in', hasEOL: true },
        ],
        [],
      ],
      {
        metadata: {
          Title: 'Specification',
          Author: 'Example',
          Custom: 'not exported',
        },
      },
    );
    const onProgress = vi.fn();

    const result = await processPdfFile(fileFixture(), {
      loadDocument: fixture.loadDocument,
      hashBytes: fixedHash,
      onProgress,
    });

    expect(result).toMatchObject({
      schema_version: '1.0.0',
      document_id: `sha256:${'a'.repeat(64)}`,
      page_count: 2,
      metadata: { title: 'Specification', author: 'Example' },
      summary: { extracted_pages: 1, needs_ocr_pages: 1, failed_pages: 0 },
    });
    expect(result.pages[0]).toMatchObject({
      page_number: 1,
      extraction_status: 'extracted',
      text: 'Cabinet width: 24 in',
      dimensions: { width_points: 612, height_points: 792, rotation_degrees: 0 },
    });
    expect(result.pages[1].extraction_status).toBe('needs_ocr');
    expect(onProgress).toHaveBeenLastCalledWith({ currentPage: 2, totalPages: 2 });
    expect(fixture.cleanup).toHaveBeenCalledTimes(2);
    expect(fixture.destroy).toHaveBeenCalledOnce();
    expect(serializePdfResult(result)).toBe(serializePdfResult(result));
  });

  it('retains explicit failed-page provenance without inventing partial content', async () => {
    const fixture = pdfFixture([[{ str: 'first' }], [{ str: 'second' }]], { failedPage: 2 });
    const result = await processPdfFile(fileFixture(), {
      loadDocument: fixture.loadDocument,
      hashBytes: fixedHash,
    });

    expect(result.summary).toEqual({ extracted_pages: 1, needs_ocr_pages: 0, failed_pages: 1 });
    expect(result.pages[1]).toMatchObject({
      page_number: 2,
      extraction_status: 'failed',
      text: '',
      error_code: 'page_extraction_failed',
    });
  });

  it('rejects PDFs over the page limit and still destroys the loading task', async () => {
    const fixture = pdfFixture(Array.from({ length: 3 }, () => []));

    await expect(
      processPdfFile(fileFixture(), {
        loadDocument: fixture.loadDocument,
        limits: { maxBytes: PDF_LIMITS.maxBytes, maxPages: 2 },
        hashBytes: fixedHash,
      }),
    ).rejects.toMatchObject({ code: 'too_many_pages' });
    expect(fixture.destroy).toHaveBeenCalledOnce();
  });

  it('maps encrypted and malformed document failures to safe user messages', async () => {
    const encrypted = Object.assign(new Error('do not expose raw error'), { name: 'PasswordException' });
    const malformed = Object.assign(new Error('parser internals'), { name: 'InvalidPDFException' });

    for (const [failure, code] of [
      [encrypted, 'encrypted_pdf'],
      [malformed, 'malformed_pdf'],
    ]) {
      const destroy = vi.fn();
      await expect(
        processPdfFile(fileFixture(), {
          loadDocument: () => ({ promise: Promise.reject(failure), destroy }),
          hashBytes: fixedHash,
        }),
      ).rejects.toMatchObject({ code });
      expect(destroy).toHaveBeenCalledOnce();
    }
  });

  it('cancels between pages and cleans up the PDF worker', async () => {
    const fixture = pdfFixture([[{ str: 'first' }], [{ str: 'second' }]]);
    let checks = 0;

    await expect(
      processPdfFile(fileFixture(), {
        loadDocument: fixture.loadDocument,
        hashBytes: fixedHash,
        shouldCancel: () => {
          checks += 1;
          return checks >= 3;
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fixture.destroy).toHaveBeenCalledOnce();
  });

  it('refuses inconsistent output before serialization', () => {
    const invalid = {
      schema_version: '1.0.0',
      document_id: `sha256:${'a'.repeat(64)}`,
      page_count: 1,
      pages: [],
      summary: { extracted_pages: 0, needs_ocr_pages: 0, failed_pages: 0 },
    };

    expect(() => validateExtractionResult(invalid)).toThrow(PdfProcessingError);
    expect(() => serializePdfResult(invalid)).toThrowError(/failed deterministic validation/i);
  });
});
