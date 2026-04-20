import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApplicationId } from '@/constants/config';
import { WorkspaceManager } from './WorkspaceManager';
import { FolderContextManager } from './FolderContextManager';

const {
  mockGetAppEndpointKey,
  mockGetAuthConfig,
  mockSetContextName,
  mockRegisterFolder,
  mockUpdateFolderName,
  mockUnregisterFolder,
  mockGetFolderRegistry,
  mockGetDocumentCount,
} = vi.hoisted(() => ({
  mockGetAppEndpointKey: vi.fn(() => 'http://localhost:2428'),
  mockGetAuthConfig: vi.fn(() => ({ jwtToken: 'token' })),
  mockSetContextName: vi.fn(),
  mockRegisterFolder: vi.fn(),
  mockUpdateFolderName: vi.fn(),
  mockUnregisterFolder: vi.fn(),
  mockGetFolderRegistry: vi.fn(),
  mockGetDocumentCount: vi.fn(),
}));

vi.mock('@calimero-network/calimero-client', () => ({
  getAppEndpointKey: mockGetAppEndpointKey,
  getAuthConfig: mockGetAuthConfig,
}));

vi.mock('./AbiClient', () => ({
  AbiClient: class MockAbiClient {
    setContextName = mockSetContextName;
    registerFolder = mockRegisterFolder;
    updateFolderName = mockUpdateFolderName;
    unregisterFolder = mockUnregisterFolder;
    getFolderRegistry = mockGetFolderRegistry;
    getDocumentCount = mockGetDocumentCount;
  },
}));

const fetchMock = vi.fn();

function jsonResponse(data: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
  };
}

describe('admin api integration', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockGetAppEndpointKey.mockReturnValue('http://localhost:2428');
    mockGetAuthConfig.mockReturnValue({ jwtToken: 'token' });
    mockSetContextName.mockReset();
    mockRegisterFolder.mockReset();
    mockUpdateFolderName.mockReset();
    mockUnregisterFolder.mockReset();
    mockGetFolderRegistry.mockReset();
    mockGetDocumentCount.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('filters workspaces to the current app and only maps the selected workspace context', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              groupId: 'group-1',
              alias: 'Product Team',
              targetApplicationId: getApplicationId(),
            },
            {
              groupId: 'group-2',
              alias: 'Other App Group',
              targetApplicationId: 'different-app-id',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ contextId: 'general-1', alias: 'General' }],
        }),
      );

    const manager = new WorkspaceManager(null);
    const workspaces = await manager.listWorkspaces('group-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:2428/admin-api/groups',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:2428/admin-api/groups/group-1/contexts',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
    expect(workspaces).toEqual([
      {
        id: 'group-1',
        name: 'Product Team',
        generalContextId: 'general-1',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves a workspace context only when that workspace is selected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { contextId: 'ctx-1', alias: 'Notes' },
          { contextId: 'general-2', alias: 'General' },
        ],
      }),
    );

    const manager = new WorkspaceManager(null);
    const generalContextId = await manager.resolveGeneralContextId('group-2');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/groups/group-2/contexts',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
    expect(generalContextId).toBe('general-2');
  });

  it('creates a workspace through the real group and context admin contract', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: { groupId: 'group-1' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { contextId: 'general-1' },
        }),
      );

    const manager = new WorkspaceManager({} as never);
    const workspace = await manager.createWorkspace('Product Team');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:2428/admin-api/groups',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        body: JSON.stringify({
          applicationId: getApplicationId(),
          upgradePolicy: 'LazyOnAccess',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:2428/admin-api/groups/group-1/alias',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        body: JSON.stringify({ alias: 'Product Team' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:2428/admin-api/contexts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );

    const createContextBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(createContextBody).toMatchObject({
      applicationId: getApplicationId(),
      protocol: 'near',
      alias: 'General',
      groupId: 'group-1',
    });
    expect(Array.isArray(createContextBody.initializationParams)).toBe(true);
    expect(mockSetContextName).toHaveBeenCalledWith({ name: 'General' });
    expect(workspace).toEqual({
      id: 'group-1',
      name: 'Product Team',
      generalContextId: 'general-1',
    });
  });

  it('creates a top-level folder context via the standard contexts endpoint before registering it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { contextId: 'folder-1' },
      }),
    );

    const manager = new FolderContextManager({} as never);
    const contextId = await manager.createFolderContext(
      'group-1',
      'general-1',
      'Specs',
      '#ff00aa',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/contexts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );

    const createContextBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(createContextBody).toMatchObject({
      applicationId: getApplicationId(),
      protocol: 'near',
      alias: 'Specs',
      groupId: 'group-1',
    });
    expect(Array.isArray(createContextBody.initializationParams)).toBe(true);
    expect(mockSetContextName).toHaveBeenCalledWith({ name: 'Specs' });
    expect(mockRegisterFolder).toHaveBeenCalledWith({
      context_id: 'folder-1',
      name: 'Specs',
      color: '#ff00aa',
    });
    expect(contextId).toBe('folder-1');
  });

  it('updates folder visibility through the node admin endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

    const manager = new FolderContextManager({} as never);
    await manager.setFolderVisibility('group-1', 'folder-1', 'restricted');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/groups/group-1/contexts/folder-1/visibility',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        body: JSON.stringify({ mode: 'restricted' }),
      }),
    );
  });

  it('reads folder visibility from the node admin endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { mode: 'restricted' },
      }),
    );

    const manager = new FolderContextManager({} as never);
    const visibility = await manager.getFolderVisibility('group-1', 'folder-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/groups/group-1/contexts/folder-1/visibility',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
    expect(visibility).toBe('restricted');
  });

  it('unregisters a folder before detaching its context from the group', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

    const manager = new FolderContextManager({} as never);
    await manager.deleteFolderContext('group-1', 'general-1', 'folder-1');

    expect(mockUnregisterFolder).toHaveBeenCalledWith({ context_id: 'folder-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/groups/group-1/contexts/folder-1/remove',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        body: JSON.stringify({}),
      }),
    );
  });
});
