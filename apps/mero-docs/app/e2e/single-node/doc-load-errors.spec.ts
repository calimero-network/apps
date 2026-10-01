// A doc the node answers "not found" for says so in words, instead of the
// generic open failure.

import { test, expect } from '../fixtures/single-user';
import { rpcMethod } from '../fixtures/rpc';
import { DOC_NOT_FOUND } from '../../src/lib/documentError';

const MISSING_DOC = 'doc-missing';

test("a doc read the node answers with the contract's NotFound shows the not-found copy", async ({
  alice,
}) => {
  await alice.goToWorkspace();
  await alice.createNamespace(`Load Errors WS ${Date.now()}`);
  await alice.createFolder({ name: 'Notes', visibility: 'Open' });
  await alice.tree.openFolder('Notes');
  await alice.createDoc('Kept');

  // The node answers for an id it never minted, so the refusal is its own.
  await alice.page.route('**/jsonrpc', (route) => {
    if (rpcMethod(route.request()) !== 'get_doc') return route.continue();
    const call = route.request().postDataJSON() as {
      params: { argsJson: object };
    };
    const argsJson = { ...call.params.argsJson, id: MISSING_DOC };
    return route.continue({
      postData: JSON.stringify({
        ...call,
        params: { ...call.params, argsJson },
      }),
    });
  });
  await alice.docs.clickDoc('Kept');

  await expect(
    alice.page.getByRole('heading', { name: "Couldn't load document" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(alice.page.getByText(DOC_NOT_FOUND)).toBeVisible();
});
