// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { dropInvite } from './lib/invites';
import { resetActiveWorkspaceForTests, setActiveWorkspace } from './lib/activeWorkspace';
import { DETAILS, ME, deps, fakeClient, hold, remember } from './test/fixtures';

const BASE = '/1.2.3/';

// The page a node serves: the app lives under `/{version}/`.
vi.mock('@calimero-apps/node-served', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@calimero-apps/node-served')>()),
  nodeBasename: () => '/1.2.3/',
}));
vi.mock('./pages/landing/LandingPage', () => ({ default: () => null }));
vi.mock('./components/PDFViewer', () => ({ default: () => null }));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

beforeEach(() => {
  localStorage.clear();
  resetActiveWorkspaceForTests();
  dropInvite();
  window.history.replaceState(null, '', BASE);
});
afterEach(cleanup);

describe('the app on a page a node serves', () => {
  it('resumes from the root: to the workspace open last, or to the workspaces', async () => {
    remember();
    setActiveWorkspace('org-1');
    render(<App deps={deps(fakeClient())} />);
    await waitFor(() => expect(window.location.pathname).toBe(`${BASE}workspaces/org-1`));
  });

  it('resumes to the workspaces when none was open', async () => {
    remember();
    render(<App deps={deps(fakeClient())} />);
    await waitFor(() => expect(window.location.pathname).toBe(`${BASE}workspaces`));
  });

  it('lets the invitation win over the late resume, and lands in the agreement', async () => {
    hold(JSON.stringify({ token: 'tok-1', agreement: 'agr-1', org: 'org-1' }));
    const client = fakeClient();
    client.view.mockImplementation(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === 'getContextDetails' ? DETAILS : method === 'whoami' ? ME : method === 'isDefaultPrivateContext' ? true : method === 'listDocuments' ? [] : method === 'listParticipants' ? [] : null,
    }));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-create'));
    await screen.findByTestId('agreement-title');
    expect(window.location.pathname).toBe(`${BASE}agreements/agr-1`);
  });
});
