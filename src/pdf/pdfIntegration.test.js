import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it, vi } from 'vitest';
import { processPdfFile } from './pdfProcessing';

function createTextPdf(text) {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let source = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(source).byteLength);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += '0000000000 65535 f \n';
  for (const offset of offsets) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(source);
}

it('extracts selectable text through the real PDF.js parser', async () => {
  const bytes = createTextPdf('Hello local PDF');
  const file = {
    name: 'integration.pdf',
    type: 'application/pdf',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0),
  };

  const result = await processPdfFile(file, {
    loadDocument: (options) => getDocument(options),
    hashBytes: vi.fn().mockResolvedValue('c'.repeat(64)),
  });

  expect(result.summary).toEqual({ extracted_pages: 1, needs_ocr_pages: 0, failed_pages: 0 });
  expect(result.pages[0].text).toBe('Hello local PDF');
  expect(result.pages[0].dimensions).toEqual({
    width_points: 612,
    height_points: 792,
    rotation_degrees: 0,
  });
});
