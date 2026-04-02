/** @generated stub from spec — will be replaced by abi-codegen after backend compiles. */
// NOTE: Class name sanitised from "Shared CounterClient" → "SharedCounterClient" (space in name is invalid TS).
// See SDK issue #1 reported against abi-codegen.

import { MeroJs } from '@calimero-network/mero-react';

export interface CounterView {
  value: number;
}

export class SharedCounterClient {
  private mero: MeroJs;
  private contextId: string;
  private executorPublicKey: string;

  constructor(mero: MeroJs, contextId: string, executorPublicKey: string) {
    this.mero = mero;
    this.contextId = contextId;
    this.executorPublicKey = executorPublicKey;
  }

  /**
   * increment — Increment the counter by 1
   */
  public async increment(): Promise<void> {
    await this.mero.rpc.execute({
      contextId: this.contextId,
      method: 'increment',
      argsJson: {},
      executorPublicKey: this.executorPublicKey,
    });
  }

  /**
   * decrement — Decrement the counter by 1
   */
  public async decrement(): Promise<void> {
    await this.mero.rpc.execute({
      contextId: this.contextId,
      method: 'decrement',
      argsJson: {},
      executorPublicKey: this.executorPublicKey,
    });
  }

  /**
   * get_value — Get the current counter value
   */
  public async getValue(): Promise<number> {
    const response = await this.mero.rpc.execute({
      contextId: this.contextId,
      method: 'get_value',
      argsJson: {},
      executorPublicKey: this.executorPublicKey,
    });
    return response as number;
  }
}
