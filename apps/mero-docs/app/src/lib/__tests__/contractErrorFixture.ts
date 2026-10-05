/** How core renders the contract's JSON behind the prefix: text (rc.81 on) or a decimal byte list (older nodes). */
export type ContractErrorShape = 'text' | 'bytes';

export const CONTRACT_ERROR_SHAPES: readonly ContractErrorShape[] = ['text', 'bytes'];

/** The error mero-js throws for a contract error, in either shape core has used. */
export function contractErrorFixture(kind: string, data: string, shape: ContractErrorShape = 'text'): Error {
  const json = JSON.stringify({ kind, data });
  const rendered = shape === 'text' ? json : `[${Array.from(new TextEncoder().encode(json)).join(', ')}]`;
  return Object.assign(new Error('FunctionCallError'), {
    type: 'FunctionCallError',
    data: `the method call returned an error: ${rendered}`,
  });
}
