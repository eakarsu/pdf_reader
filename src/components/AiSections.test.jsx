import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AiSections from './AiSections';

describe('AiSections (wave 15A)', () => {
  it('renders labelled sections preserving false, 0 and empty values', () => {
    render(<AiSections value={{ aiGenerated: false, sections: { metrics: { totalTasks: 0, openTasks: 2 }, note: '' }, findings: [] }} />);
    expect(screen.getByRole('heading', { name: 'Ai Generated' })).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Total Tasks' })).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Empty string')).toBeInTheDocument();
    expect(screen.getByText('No items returned.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('{');
  });
});
