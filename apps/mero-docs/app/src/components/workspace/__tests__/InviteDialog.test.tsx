import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { InviteDialog } from '../InviteDialog';

const client = {};
const inviteTarget = vi.fn();
vi.mock('@/calimero/react', () => ({ useLive: () => ({ client, admin: { inviteTarget } }) }));
vi.mock('@/calimero/session', () => ({ useSession: () => ({ passkey: () => ({ id: 'pk' }) }) }));
vi.mock('@/lib/servedByNode', () => ({ nodeUrl: (p: string) => `https://node.example/v1${p}`, nodeBasename: () => '/v1' }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// The shared dialog is mero-react's to test: here only what this hands it.
const shared = vi.hoisted(() => ({ props: undefined as undefined | Record<string, unknown> }));
vi.mock('@calimero-network/mero-react', () => ({
  InviteDialog: (p: Record<string, unknown>) => {
    shared.props = p;
    return <div role="dialog" />;
  },
}));

const labels = { title: 'Invite to workspace' };

beforeEach(() => {
  inviteTarget.mockReset();
  shared.props = undefined;
  vi.mocked(toast.error).mockReset();
});

describe('InviteDialog', () => {
  it('hands the workspace, its app team and a link base naming the workspace to the shared dialog', async () => {
    inviteTarget.mockResolvedValue({ org: 'org-1', team: null, teams: ['docs-team'] });
    render(<InviteDialog groupId="org-1" labels={labels} open onClose={vi.fn()} />);

    await screen.findByRole('dialog');
    expect(inviteTarget).toHaveBeenCalledWith('org-1');
    expect(shared.props).toMatchObject({
      client,
      org: 'org-1',
      teams: ['docs-team'],
      appName: 'Hyperfeed Docs',
      labels,
      open: true,
    });
    const base = new URL(shared.props!.linkBase as string);
    expect(base.origin + base.pathname).toBe('https://node.example/v1/');
    expect(Object.fromEntries(base.searchParams)).toEqual({ org: 'org-1', kind: 'namespace' });
  });

  it('names the folder in the link base for a folder invite', async () => {
    inviteTarget.mockResolvedValue({ org: 'org-1', team: 'eng', teams: ['docs-team', 'eng'] });
    render(<InviteDialog groupId="eng" labels={labels} open onClose={vi.fn()} />);

    await screen.findByRole('dialog');
    expect(shared.props).toMatchObject({ org: 'org-1', teams: ['docs-team', 'eng'] });
    const base = new URL(shared.props!.linkBase as string);
    expect(Object.fromEntries(base.searchParams)).toEqual({ org: 'org-1', team: 'eng', kind: 'group' });
  });

  it('adds the invites-to-this-app-only note and the inviter where the org keeps its apps apart', async () => {
    inviteTarget.mockResolvedValue({ org: 'org-1', team: null, teams: ['docs-team'], appOnly: true });
    render(<InviteDialog groupId="org-1" labels={labels} inviterName="Ada" open onClose={vi.fn()} />);

    await screen.findByRole('dialog');
    expect(shared.props).toMatchObject({ inviterName: 'Ada', labels: { title: 'Invite to workspace' } });
    expect((shared.props!.labels as { note: string }).note).toMatch(/^Invites to Hyperfeed Docs only/);
  });

  it('looks nothing up while closed', () => {
    render(<InviteDialog groupId="org-1" labels={labels} open={false} onClose={vi.fn()} />);
    expect(inviteTarget).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says why and closes when the invite cannot be placed', async () => {
    inviteTarget.mockRejectedValue(new Error('This organization has not set up Hyperfeed Docs yet.'));
    const onClose = vi.fn();
    render(<InviteDialog groupId="org-1" labels={labels} open onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('has not set up Hyperfeed Docs'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
