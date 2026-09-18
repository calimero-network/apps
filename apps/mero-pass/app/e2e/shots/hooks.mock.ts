// Aliased over the two hooks that ask a node a question.
import { VARIANT } from './fixtures';
import { ADMIN_CAPABILITIES, MEMBER_CAPABILITIES } from '../../src/lib/roles';

export function useApplicationId() {
  const notInstalled = VARIANT === 'notInstalled';
  return {
    appId: notInstalled ? '' : 'app-mero-pass',
    resolving: false,
    notInstalled,
  };
}

export function clearApplicationIdCache() {}

export function useTeamCapabilities() {
  const member = VARIANT === 'member' || VARIANT === 'peopleMember';
  return {
    accountId: 'a'.repeat(64),
    capabilities: member ? MEMBER_CAPABILITIES : ADMIN_CAPABILITIES,
    loading: false,
    refetch: async () => {},
  };
}
