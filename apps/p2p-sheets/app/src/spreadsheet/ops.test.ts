import { describe, it, expect } from 'vitest';
import { setOp, formatOp, clearOp, opsFromWrites, type CellOp } from './ops';

describe('ops builders', () => {
  it('builds discriminated CellOps', () => {
    expect(setOp(0, 1, '=A1')).toEqual({ kind: 'Set', row: 0, col: 1, raw_value: '=A1' });
    expect(formatOp(2, 3, 'number')).toEqual({ kind: 'Format', row: 2, col: 3, format: 'number' });
    expect(clearOp(4, 5)).toEqual({ kind: 'Clear', row: 4, col: 5 });
  });

  it('opsFromWrites emits a Set per write and a Format when present', () => {
    const ops: CellOp[] = opsFromWrites([
      { row: 0, col: 0, raw: '1', format: '' },
      { row: 0, col: 1, raw: '=A1', format: 'number' },
    ]);
    expect(ops).toEqual([
      { kind: 'Set', row: 0, col: 0, raw_value: '1' },
      { kind: 'Set', row: 0, col: 1, raw_value: '=A1' },
      { kind: 'Format', row: 0, col: 1, format: 'number' },
    ]);
  });
});
