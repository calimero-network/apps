import { describe, it, expect, vi } from 'vitest';
import { UndoHistory } from '../undo';

describe('UndoHistory', () => {
  it('has nothing to undo or redo when fresh', async () => {
    const history = new UndoHistory('doc-1');
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    const apply = vi.fn();
    expect(await history.undo(apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('hands the recorded token to undo and keeps the redo it returned', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    const apply = vi.fn().mockResolvedValue('r1');
    expect(await history.undo(apply)).toBe(true);
    expect(apply).toHaveBeenCalledWith('t1');
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it('puts the token a redo returned back on the undo stack', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    await history.undo(vi.fn().mockResolvedValue('r1'));
    const apply = vi.fn().mockResolvedValue('t1-again');
    expect(await history.redo(apply)).toBe(true);
    expect(apply).toHaveBeenCalledWith('r1');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    const undoApply = vi.fn().mockResolvedValue('r2');
    await history.undo(undoApply);
    expect(undoApply).toHaveBeenCalledWith('t1-again');
  });

  it('undoes in reverse order', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    history.record('t2');
    const apply = vi.fn().mockResolvedValue('r');
    await history.undo(apply);
    await history.undo(apply);
    expect(apply.mock.calls).toEqual([['t2'], ['t1']]);
  });

  it('drops the redo stack on a fresh edit', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    await history.undo(vi.fn().mockResolvedValue('r1'));
    history.record('t2');
    expect(history.canRedo()).toBe(false);
  });

  it('clears both stacks when the document changes', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    await history.undo(vi.fn().mockResolvedValue('r1'));
    history.record('t2');
    history.reset('doc-2');
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('keeps the stacks when reset names the same document', () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    history.reset('doc-1');
    expect(history.canUndo()).toBe(true);
  });

  it('restores the token when applying it throws', async () => {
    const history = new UndoHistory('doc-1');
    history.record('t1');
    await expect(
      history.undo(vi.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toThrow('offline');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });
});
