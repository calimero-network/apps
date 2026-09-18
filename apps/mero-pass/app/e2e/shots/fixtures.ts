/** Scenario table for the screenshot harness. Kept in step with e2e/shots.mjs. */
export type Scenario = {
  id: string;
  page: 'teams' | 'team' | 'vault' | 'landing';
  /** What the fixtures should answer with. */
  variant?: string;
};

export const SCENARIOS: Scenario[] = [
  { id: 'teams', page: 'teams' },
  { id: 'teams-no-personal', page: 'teams', variant: 'noPersonal' },
  { id: 'teams-empty', page: 'teams', variant: 'empty' },
  { id: 'teams-error', page: 'teams', variant: 'error' },
  { id: 'teams-not-installed', page: 'teams', variant: 'notInstalled' },
  { id: 'team-vaults', page: 'team' },
  { id: 'team-empty', page: 'team', variant: 'empty' },
  { id: 'team-member', page: 'team', variant: 'member' },
  { id: 'team-people', page: 'team', variant: 'people' },
  { id: 'team-people-member', page: 'team', variant: 'peopleMember' },
  { id: 'team-people-mismatch', page: 'team', variant: 'peopleMismatch' },
  { id: 'vault', page: 'vault' },
  { id: 'vault-personal', page: 'vault', variant: 'personal' },
  { id: 'vault-empty', page: 'vault', variant: 'empty' },
  { id: 'vault-activity', page: 'vault', variant: 'activity' },
  { id: 'vault-no-identity', page: 'vault', variant: 'noIdentity' },
  { id: 'landing', page: 'landing' },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

export const VARIANT =
  typeof location !== 'undefined'
    ? (scenarioById(new URLSearchParams(location.search).get('s') ?? 'teams')
        .variant ?? '')
    : '';
