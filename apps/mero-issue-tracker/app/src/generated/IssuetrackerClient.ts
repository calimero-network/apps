/** @generated stub from spec — will be replaced by abi-codegen after backend compiles. */

import { MeroJs } from '@calimero-network/mero-react';



export class IssuetrackerClient {
  private mero: MeroJs;
  private contextId: string;
  private executorPublicKey: string;

  constructor(mero: MeroJs, contextId: string, executorPublicKey: string) {
    this.mero = mero;
    this.contextId = contextId;
    this.executorPublicKey = executorPublicKey;
  }


}
