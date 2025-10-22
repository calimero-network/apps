export interface UpdateFunction<T> {
  (currentMessage: T): Partial<T>;
}

export type UpdateDescriptor<T> =
  | { updatedFields: Partial<T> }
  | { updateFunction: UpdateFunction<T> };

type InternalMessage<T> = T & { version?: number };

class MessageStore<
  T extends {
    id: string;
    timestamp: number;
  },
> {
  public messages: InternalMessage<T>[] = [];

  private messageMap: Map<string, number> = new Map();

  private startOffset: number = 0;

  private endOffset: number = 0;

  private updateLookup(messages: T[], isPrepend: boolean = false) {
    messages.forEach((msg, index) => {
      if (!msg.id) {
        throw new Error("Message must have a valid ID");
      }

      const globalIndex = isPrepend
        ? this.startOffset + index
        : this.endOffset + index;

      this.messageMap.set(msg.id, globalIndex);
    });
  }

  reset() {
    this.messages = [];
    this.startOffset = 0;
    this.endOffset = 0;
    this.messageMap.clear();
  }

  prepend(messages: T[]): void {
    // Sort messages by timestamp to ensure correct chronological order
    const sortedMessages = [...messages].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    this.messages = sortedMessages.concat(this.messages);
    this.startOffset -= sortedMessages.length;
    this.updateLookup(sortedMessages, true);
  }

  initial(messages: T[]): void {
    this.reset();
    // Sort messages by timestamp to ensure correct chronological order
    const sortedMessages = [...messages].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    this.append(sortedMessages);
  }

  append(messages: T[]): { addedCount: number; updatedCount: number } {
    if (messages.length === 0) {
      return { addedCount: 0, updatedCount: 0 };
    }

    let updatedCount = 0;
    const messagesToAdd: T[] = [];
    const idsToSkip = new Set<string>();

    // Build temp messages lookup map once - O(m) where m = existing messages
    const tempMessagesMap = new Map<
      string,
      T & { text?: string; sender?: string }
    >();
    const tempMessagesByContent = new Map<
      string,
      Array<T & { text?: string; sender?: string }>
    >();

    for (const existingMsg of this.messages) {
      const msg = existingMsg as T & { text?: string; sender?: string };
      if (msg.id.startsWith("temp-")) {
        // Primary key: exact match on content and timestamp (rounded to second)
        const exactKey = `${msg.sender}:${msg.text}:${Math.floor(msg.timestamp / 1000)}`;
        tempMessagesMap.set(exactKey, msg);

        // Secondary key: for fuzzy matching with timestamp tolerance
        const contentKey = `${msg.sender}:${msg.text}`;
        if (!tempMessagesByContent.has(contentKey)) {
          tempMessagesByContent.set(contentKey, []);
        }
        tempMessagesByContent.get(contentKey)!.push(msg);
      }
    }

    // Process all incoming messages in a single pass - O(n)
    for (const msg of messages) {
      // Skip if already exists
      if (this.messageMap.has(msg.id)) {
        continue;
      }

      // Check if this is a real message that matches a temp message
      if (!msg.id.startsWith("temp-")) {
        const realMsg = msg as T & { text?: string; sender?: string };
        const exactKey = `${realMsg.sender}:${realMsg.text}:${Math.floor(realMsg.timestamp / 1000)}`;
        let matchingTempMsg = tempMessagesMap.get(exactKey);

        // Try fuzzy matching if exact match failed
        if (!matchingTempMsg) {
          const contentKey = `${realMsg.sender}:${realMsg.text}`;
          const candidates = tempMessagesByContent.get(contentKey);

          if (candidates) {
            // Find first candidate within 10 second window
            matchingTempMsg = candidates.find(
              (tempMsg) =>
                Math.abs(tempMsg.timestamp - realMsg.timestamp) < 10000,
            );
          }
        }

        if (matchingTempMsg) {
          // Update temp message in place
          const { id, ...realDataWithoutId } = realMsg;
          this._updateWithoutVersion(
            matchingTempMsg.id,
            realDataWithoutId as Partial<T>,
          );
          updatedCount++;
          idsToSkip.add(msg.id);
          continue;
        }
      }

      // Add to list of messages to append
      messagesToAdd.push(msg);
    }

    // Sort and add new messages if any
    if (messagesToAdd.length > 0) {
      // Sort by timestamp for chronological order
      messagesToAdd.sort((a, b) => a.timestamp - b.timestamp);

      // Update lookup and append
      this.updateLookup(messagesToAdd);
      this.messages = this.messages.concat(messagesToAdd);
      this.endOffset += messagesToAdd.length;
    }

    return { addedCount: messagesToAdd.length, updatedCount };
  }

  _update(oldId: string, updatedFields: Partial<T>): void {
    const globalIndex = this.messageMap.get(oldId);
    if (globalIndex == undefined) return;
    const localIndex = globalIndex - this.startOffset;
    if (
      updatedFields.id &&
      updatedFields.id !== oldId &&
      this.messageMap.has(updatedFields.id)
    ) {
      throw new Error(
        `A message with ID "${updatedFields.id}" already exists.`,
      );
    }
    const existingMessage = this.messages[localIndex];

    const version = existingMessage?.version ? existingMessage.version + 1 : 1;

    this.messages[localIndex] = {
      ...existingMessage,
      ...updatedFields,
      version,
    };

    if (updatedFields.id && updatedFields.id !== oldId) {
      this.messageMap.delete(oldId);
      this.messageMap.set(updatedFields.id, globalIndex);
    }
  }

  _updateWithoutVersion(oldId: string, updatedFields: Partial<T>): void {
    const globalIndex = this.messageMap.get(oldId);
    if (globalIndex == undefined) return;
    const localIndex = globalIndex - this.startOffset;
    const existingMessage = this.messages[localIndex];

    // Update without incrementing version to keep React key stable
    this.messages[localIndex] = {
      ...existingMessage,
      ...updatedFields,
    };
  }

  computeKey(item: InternalMessage<T>): string {
    // Use timestamp and nonce as additional uniqueness factors
    // Following Virtuoso best practice for stable, unique keys
    const itemAny = item as any;
    const nonce = itemAny.nonce || "";
    return `${item.id}_${nonce}_${item.version ?? 0}`;
  }

  _applyUpdateFunction(oldId: string, updateFunction: UpdateFunction<T>) {
    const globalIndex = this.messageMap.get(oldId);
    if (globalIndex == undefined) return;
    const localIndex = globalIndex - this.startOffset;
    const existingMessage = this.messages[localIndex];
    const updatedFields = updateFunction(existingMessage);
    this._update(oldId, updatedFields);
  }

  getItem(index: number): InternalMessage<T> {
    const localIndex = index - this.startOffset;
    return this.messages[localIndex];
  }

  updateMultiple(
    updates: {
      id: string;
      descriptor: UpdateDescriptor<T>;
    }[],
  ): void {
    updates.forEach((update) => {
      if (update.id) {
        if (
          "updatedFields" in update.descriptor &&
          "updateFunction" in update.descriptor
        ) {
          throw new Error(
            "Message update descriptor cannot have both updatedFields and updateFunction",
          );
        }
        if ("updatedFields" in update.descriptor) {
          this._update(update.id, update.descriptor?.updatedFields);
        }
        if ("updateFunction" in update.descriptor) {
          this._applyUpdateFunction(
            update.id,
            update.descriptor?.updateFunction,
          );
        }
      } else {
        throw new Error("Message must have a valid ID");
      }
    });
  }
}

export default MessageStore;
