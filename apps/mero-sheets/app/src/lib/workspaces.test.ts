import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from '@calimero-network/mero-js';
import {
  DEFAULT_CAPABILITIES,
  ensureNamespace,
  acceptInvite,
  enterSpreadsheet,
  isAlreadyMember,
  listSpreadsheets,
  mintInvite,
  namespaceLabel,
  spreadsheetFallbackLabel,
  unwrapInvitation,
  type AdminLike,
} from './workspaces';
import { decodeInvite, type SignedInvitation } from './inviteCodec';

const GROUP_BYTES = Array.from({ length: 32 }, (_, i) => i + 1);
const GROUP_HEX = GROUP_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

const SIGNED: SignedInvitation = {
  invitation: { groupId: GROUP_BYTES },
  inviterSignature: 'a'.repeat(128),
};

/** Just enough of the admin client for the call under test. */
const admin = (parts: Partial<Record<string, unknown>>) =>
  parts as unknown as AdminLike;

describe('unwrapInvitation', () => {
  it('descends to the object that carries the signature', () => {
    // The join endpoints want the invitation OBJECT — not a wrapper around it.
    expect(unwrapInvitation(SIGNED)).toBe(SIGNED);
    expect(unwrapInvitation({ invitation: SIGNED })).toBe(SIGNED);
    expect(unwrapInvitation({ invitation: { invitation: SIGNED } })).toBe(SIGNED);
  });

  it('accepts either signature spelling', () => {
    const snake = { invitation: {}, inviter_signature: 'x' };
    expect(unwrapInvitation({ invitation: snake })).toBe(snake);
  });

  it('is null when nothing in there is signed', () => {
    expect(unwrapInvitation(null)).toBeNull();
    expect(unwrapInvitation({ invitation: { groupId: GROUP_HEX } })).toBeNull();
    expect(unwrapInvitation('nope')).toBeNull();
  });
});

describe('isAlreadyMember', () => {
  it('recognises the node’s wordings for "you are already in"', () => {
    // Re-opening a link is the normal case, and it must end with the user
    // inside rather than staring at a success styled as an error.
    for (const m of [
      'already a member of this group',
      'AlreadyJoined',
      'duplicate member',
      'user already joined',
    ]) {
      expect(isAlreadyMember(new Error(m))).toBe(true);
    }
  });

  it('does not swallow a real failure', () => {
    expect(isAlreadyMember(new Error('403 forbidden'))).toBe(false);
    expect(isAlreadyMember(new Error('network error'))).toBe(false);
  });
});

describe('namespaceLabel / spreadsheetFallbackLabel', () => {
  it('prefers the name the node has', () => {
    expect(namespaceLabel({ namespaceId: 'abc123def', name: 'Finance' }, 'Sheets')).toBe(
      'Finance',
    );
  });

  it('falls back to something readable, never a bare 64-hex id', () => {
    const label = namespaceLabel({ namespaceId: 'abc123def456' }, 'Sheets');
    expect(label).toBe('Sheets · abc123');
    expect(namespaceLabel({ namespaceId: 'abc123def456', name: '  ' }, 'Sheets')).toBe(
      label,
    );
    expect(spreadsheetFallbackLabel('deadbeefcafe')).toBe('Untitled · deadbe');
  });
});

describe('listSpreadsheets', () => {
  it('uses the listing name when the node populates it — no extra round-trip', async () => {
    const getContextMetadata = vi.fn();
    const rows = await listSpreadsheets(
      admin({ getContextMetadata }),
      'ns',
      [{ contextId: 'ctx1', name: 'Q3 Budget' }],
    );
    expect(rows).toEqual([{ contextId: 'ctx1', name: 'Q3 Budget', unnamed: false }]);
    expect(getContextMetadata).not.toHaveBeenCalled();
  });

  it('reads the replicated metadata record when the listing has no name', async () => {
    // This is the source that works for someone who JOINED: they can read the
    // name without holding an identity in the context.
    const rows = await listSpreadsheets(
      admin({
        getContextMetadata: async () => ({ name: 'Q3 Budget', data: {} }),
      }),
      'ns',
      [{ contextId: 'ctx1' }],
    );
    expect(rows[0].name).toBe('Q3 Budget');
    expect(rows[0].unnamed).toBe(false);
  });

  it('degrades ONE row to a flagged placeholder, never the whole list', async () => {
    const rows = await listSpreadsheets(
      admin({
        getContextMetadata: async (_ns: string, ctx: string) => {
          if (ctx === 'bad') throw new Error('not replicated here yet');
          return { name: 'Good', data: {} };
        },
      }),
      'ns',
      [{ contextId: 'bad' }, { contextId: 'ok' }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      contextId: 'bad',
      name: 'Untitled · bad',
      unnamed: true,
    });
    expect(rows[1].name).toBe('Good');
  });
});

describe('mintInvite', () => {
  it('does NOT ask for a recursive invitation', async () => {
    // `{recursive: true}` changes the response shape to `{invitations: […]}` and
    // there is nothing to recurse into: this app has no subgroups.
    const createNamespaceInvitation = vi.fn(async () => ({ invitation: SIGNED }));
    await mintInvite(admin({ createNamespaceInvitation }), { namespaceId: 'ns' });
    expect(createNamespaceInvitation).toHaveBeenCalledWith('ns', {});
  });

  it('carries the names into the code, and they round-trip', async () => {
    const code = await mintInvite(
      admin({ createNamespaceInvitation: async () => ({ invitation: SIGNED }) }),
      {
        namespaceId: GROUP_HEX,
        namespaceName: 'Finance team',
        contextId: 'ctx1',
        projectName: 'Q3 Budget',
      },
    );
    const decoded = decodeInvite(code)!;
    expect(decoded.groupAlias).toBe('Finance team');
    expect(decoded.projectName).toBe('Q3 Budget');
    expect(decoded.contextId).toBe('ctx1');
  });

  it('refuses an unsigned response instead of minting a dead code', async () => {
    await expect(
      mintInvite(
        admin({ createNamespaceInvitation: async () => ({ invitation: {} }) }),
        { namespaceId: 'ns' },
      ),
    ).rejects.toThrow(/signature/i);
  });
});

describe('acceptInvite', () => {
  it('joins the namespace named INSIDE the signature, not the wrapper', async () => {
    const joinNamespace = vi.fn(async () => ({}));
    await acceptInvite(admin({ joinNamespace }), {
      invitation: SIGNED,
      // A tampered wrapper pointing somewhere else.
      groupId: 'f'.repeat(64),
      groupAlias: 'Finance team',
    });
    expect(joinNamespace).toHaveBeenCalledWith(GROUP_HEX, {
      invitation: SIGNED,
      groupName: 'Finance team',
    });
  });

  it('omits groupName entirely when the code carries no name', async () => {
    // Every core request body is a closed set; a speculative key is a 400 for
    // the whole call, so an absent name must be an absent FIELD.
    const joinNamespace = vi.fn(async () => ({}));
    await acceptInvite(admin({ joinNamespace }), { invitation: SIGNED });
    expect(joinNamespace).toHaveBeenCalledWith(GROUP_HEX, { invitation: SIGNED });
  });

  it('treats "already a member" as success and still reports the namespace', async () => {
    const result = await acceptInvite(
      admin({
        joinNamespace: async () => {
          throw new Error('already a member');
        },
      }),
      { invitation: SIGNED, contextId: 'ctx1', projectName: 'Q3 Budget' },
    );
    expect(result.namespaceId).toBe(GROUP_HEX);
    expect(result.contextId).toBe('ctx1');
    expect(result.projectName).toBe('Q3 Budget');
  });

  it('rethrows a real failure', async () => {
    await expect(
      acceptInvite(
        admin({
          joinNamespace: async () => {
            throw new Error('403 forbidden');
          },
        }),
        { invitation: SIGNED },
      ),
    ).rejects.toThrow('403 forbidden');
  });
});

describe('enterSpreadsheet', () => {
  it('uses an identity we already own, without joining anything', async () => {
    const joinContext = vi.fn();
    const id = await enterSpreadsheet(
      admin({
        getContextIdentitiesOwned: async () => ({ identities: ['abc'] }),
        joinContext,
      }),
      'ctx1',
    );
    expect(id).toBe('abc');
    expect(joinContext).not.toHaveBeenCalled();
  });

  it('JOINS when we own none — the case that used to hang forever', async () => {
    // Auto-follow carries an identity only into contexts created after you
    // became a member, which is never true for someone joining by invitation.
    // Waiting for one that is never coming is what left an invited collaborator
    // on "Opening workspace…" with nothing logged.
    const id = await enterSpreadsheet(
      admin({
        getContextIdentitiesOwned: async () => ({ identities: [] }),
        joinContext: async () => ({ contextId: 'ctx1', memberPublicKey: 'joined' }),
      }),
      'ctx1',
    );
    expect(id).toBe('joined');
  });
});

// ── rc.41: the namespace default mask is load-bearing ───────────────────────
//
// 0.11.0-rc.41 seeds a new namespace root with
// `CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF` (core's
// `initial_default_capabilities`, #3969) and publishes it as a governance op so
// it replicates to every peer (#3974). `CAN_AUTHOR_ON_BEHALF` is "write as
// somebody else", which in a shared spreadsheet means edits attributed to a
// collaborator who did not make them.
//
// `ensureNamespace` overwrites that seed. It had no test at all before this.

describe('ensureNamespace — the rc.41 default mask', () => {
  /** Records every call, so the MASK can be asserted and not just the outcome. */
  function recording(over: Record<string, () => unknown> = {}) {
    const calls: { method: string; args: unknown[] }[] = [];
    const rec =
      (method: string, impl?: () => unknown) =>
      (...args: unknown[]) => {
        calls.push({ method, args });
        // `Promise.resolve().then(...)` so an override that throws produces a
        // REJECTED PROMISE rather than a synchronous throw. A synchronous throw
        // bypasses `.catch()` at the call site — which made the first draft of
        // this suite pass against the very bug it exists to catch.
        return Promise.resolve().then(() => (over[method] ?? impl)?.());
      };
    return {
      calls,
      client: {
        createNamespace: rec('createNamespace', () => ({
          namespaceId: 'ns-1',
        })),
        setGroupMetadata: rec('setGroupMetadata'),
        setDefaultCapabilities: rec('setDefaultCapabilities'),
        setSubgroupVisibility: rec('setSubgroupVisibility'),
      } as unknown as AdminLike,
    };
  }

  it('never sends CAN_AUTHOR_ON_BEHALF', async () => {
    const { client, calls } = recording();
    await ensureNamespace(client, {
      applicationId: 'app-1',
      existingNamespaceId: null,
      name: 'Books',
    });
    const call = calls.find((c) => c.method === 'setDefaultCapabilities');
    const sent = (call?.args[1] as { defaultCapabilities: number })
      .defaultCapabilities;
    expect(sent & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
    expect(sent).toBe(DEFAULT_CAPABILITIES);
  });

  it('fails the whole call when the node refuses the write', async () => {
    const { client } = recording({
      setDefaultCapabilities: () => {
        throw new Error('503');
      },
    });
    await expect(
      ensureNamespace(client, {
        applicationId: 'app-1',
        existingNamespaceId: null,
        name: 'Books',
      }),
    ).rejects.toThrow('503');
  });
});
