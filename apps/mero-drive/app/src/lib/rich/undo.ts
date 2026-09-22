// The backend keeps no undo stack: every write returns the token its inverse
// takes, and applying that token returns the token of the inverse of the
// inverse. So a redo token simply replaces the undo token it came from.

export class UndoHistory {
  private readonly undoTokens: string[] = [];
  private readonly redoTokens: string[] = [];

  constructor(private documentId: string | null = null) {}

  /** Point the history at a document, clearing it when that is a new one. */
  reset(documentId: string | null): void {
    if (documentId === this.documentId) return;
    this.documentId = documentId;
    this.undoTokens.length = 0;
    this.redoTokens.length = 0;
  }

  /** Take the undo token a local write returned. */
  record(token: string): void {
    this.undoTokens.push(token);
    this.redoTokens.length = 0;
  }

  canUndo(): boolean {
    return this.undoTokens.length > 0;
  }

  canRedo(): boolean {
    return this.redoTokens.length > 0;
  }

  /** Apply the newest undo token; false when there is nothing to undo. */
  undo(apply: (token: string) => Promise<string>): Promise<boolean> {
    return this.step(this.undoTokens, this.redoTokens, apply);
  }

  /** Apply the newest redo token; false when there is nothing to redo. */
  redo(apply: (token: string) => Promise<string>): Promise<boolean> {
    return this.step(this.redoTokens, this.undoTokens, apply);
  }

  private async step(
    from: string[],
    to: string[],
    apply: (token: string) => Promise<string>,
  ): Promise<boolean> {
    const token = from.pop();
    if (token === undefined) return false;
    const documentId = this.documentId;
    let inverse: string;
    try {
      inverse = await apply(token);
    } catch (error) {
      if (documentId === this.documentId) from.push(token);
      throw error;
    }
    if (documentId === this.documentId) to.push(inverse);
    return true;
  }
}
