import { describe, expect, it } from 'vitest';
import { renderBenchmarkPage, renderReadmeTable } from '../src/report.js';
import type { RunRecord } from '../src/types.js';

const record: RunRecord = {
  startedAt: '2026-07-09T10:00:00.000Z',
  manifestChecksum: 'abc123def456abc123def456',
  runs: [
    {
      model: 'claude-sonnet-5',
      docs: [
        {
          docId: 'cord/test/0',
          dataset: 'cord',
          schema: 'receipt',
          error: null,
          extraLineItems: 0,
          usage: { inputTokens: 1000, outputTokens: 100, modelCalls: 1, costUSD: 0.0045 },
          fields: [
            { path: 'total', compare: 'money', expected: '1', predicted: '1', valueCorrect: true, iou: 0.9, predictedPage: 0 },
            { path: 'tax', compare: 'money', expected: '2', predicted: null, valueCorrect: false, iou: null, predictedPage: null },
          ],
        },
      ],
    },
  ],
};

describe('renderReadmeTable', () => {
  it('renders one section per schema with real numbers only', () => {
    const table = renderReadmeTable(record);
    expect(table).toContain('Receipts — CORD-v2');
    expect(table).not.toContain('DocILE'); // no invoice run in the record
    expect(table).toContain('| claude-sonnet-5 | 1 | 50.0% | 100.0% | 90.0% | $4.50 |');
  });
});

describe('renderBenchmarkPage', () => {
  it('includes metric definitions, per-field table, and caveats', () => {
    const page = renderBenchmarkPage(record);
    expect(page).toContain('# extractkit benchmark');
    expect(page).toContain('Run started 2026-07-09T10:00:00.000Z');
    expect(page).toContain('`total`');
    expect(page).toContain('## Caveats');
    expect(page).toContain('CC BY 4.0');
  });
});
