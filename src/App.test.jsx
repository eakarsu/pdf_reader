import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processPdfFileMock, serializePdfResultMock } = vi.hoisted(() => ({
  processPdfFileMock: vi.fn(),
  serializePdfResultMock: vi.fn().mockReturnValue('{"ok":true}\n'),
}));

vi.mock('./pdf/pdfJsAdapter', () => ({ loadPdfDocument: vi.fn() }));
vi.mock('./pdf/pdfProcessing', () => ({
  PDF_LIMITS: { maxBytes: 25 * 1024 * 1024, maxPages: 100 },
  processPdfFile: processPdfFileMock,
  serializePdfResult: serializePdfResultMock,
}));

import App from './App';

const resultFixture = {
  schema_version: '1.0.0',
  document_id: `sha256:${'b'.repeat(64)}`,
  source: { file_name: 'sample.pdf' },
  page_count: 2,
  summary: { extracted_pages: 1, needs_ocr_pages: 1, failed_pages: 0 },
  pages: [
    { page_number: 1, extraction_status: 'extracted', text: 'Readable text' },
    { page_number: 2, extraction_status: 'needs_ocr', text: '' },
  ],
};

describe('Local PDF Reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processPdfFileMock.mockResolvedValue(resultFixture);
  });

  it('states the local-only boundary and disables processing before selection', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Local PDF Reader' })).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extract text' })).toBeDisabled();
  });

  it('processes a selected file and presents provenance and page warnings', async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Select PDF'), file);
    expect(screen.getByText('sample.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Extract text' }));

    expect(await screen.findByRole('heading', { name: 'Extraction complete' })).toBeInTheDocument();
    expect(screen.getByText(resultFixture.document_id)).toBeInTheDocument();
    expect(screen.getByText('Readable text')).toBeInTheDocument();
    expect(screen.getByText(/never guesses missing content/i)).toBeInTheDocument();
    expect(processPdfFileMock).toHaveBeenCalledOnce();
  });

  it('downloads only validated serialized JSON', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);

    await user.upload(
      screen.getByLabelText('Select PDF'),
      new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Extract text' }));
    await user.click(await screen.findByRole('button', { name: 'Download JSON' }));

    expect(serializePdfResultMock).toHaveBeenCalledWith(resultFixture);
    expect(createObjectURL).toHaveBeenCalledOnce();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:test'));
  });

  it('renders safe processing failures and allows the file to be removed', async () => {
    const user = userEvent.setup();
    processPdfFileMock.mockRejectedValue({
      code: 'encrypted_pdf',
      message: 'Password-protected PDFs are not supported.',
    });
    render(<App />);

    await user.upload(
      screen.getByLabelText('Select PDF'),
      new File(['%PDF-1.7'], 'locked.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Extract text' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password-protected PDFs');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('locked.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extract text' })).toBeDisabled();
  });

  it('honors cancellation without retaining output', async () => {
    const user = userEvent.setup();
    processPdfFileMock.mockImplementation(
      (_file, options) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (options.shouldCancel()) reject({ code: 'cancelled' });
            else resolve(resultFixture);
          }, 100);
        }),
    );
    render(<App />);

    await user.upload(
      screen.getByLabelText('Select PDF'),
      new File(['%PDF-1.7'], 'sample.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Extract text' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
    expect(screen.queryByRole('heading', { name: 'Extraction complete' })).not.toBeInTheDocument();
  });
});
