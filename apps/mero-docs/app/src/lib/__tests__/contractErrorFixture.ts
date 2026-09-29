/** The error mero-js throws for a contract error: core renders the app's JSON bytes as a decimal list in `data`. */
export function contractErrorFixture(kind: string, data: string): Error {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ kind, data })));
  return Object.assign(new Error('FunctionCallError'), {
    type: 'FunctionCallError',
    data: `the method call returned an error: [${bytes.join(', ')}]`,
  });
}
