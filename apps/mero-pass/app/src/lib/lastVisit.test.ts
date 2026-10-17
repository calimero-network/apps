import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetLastVisits,
  lastVisitKey,
  pickTeam,
  pickVault,
  readLastVisit,
  rememberTeam,
  rememberVault,
} from './lastVisit';

const NODE = 'http://localhost:2528';

// Signing in, or reloading the desktop window, used to land on the teams list
// every time — then a team, then a vault, to get back to where you were. The
// landing redirect now resumes there, and these are the rules it resumes by.
describe('last visit', () => {
  beforeEach(() => localStorage.clear());

  it('is empty on a cold start', () => {
    expect(readLastVisit(NODE)).toEqual({});
  });

  it('remembers the vault open last, and the team it is in', () => {
    rememberVault(NODE, 'team-a', 'ctx-1');
    expect(readLastVisit(NODE)).toEqual({ team: 'team-a', vault: 'ctx-1' });
  });

  it('opening a team afterwards makes the team the place to resume', () => {
    // Vault → back to its team → reload: you were on the team screen, so that
    // is where you go back to, not into the vault you had left.
    rememberVault(NODE, 'team-a', 'ctx-1');
    rememberTeam(NODE, 'team-b');
    expect(readLastVisit(NODE)).toEqual({ team: 'team-b' });
  });

  it('is kept per node: another node’s ids mean nothing here', () => {
    rememberTeam(NODE, 'team-a');
    expect(readLastVisit('http://other-node:2528').team).toBeUndefined();
    // A trailing slash is the same node.
    expect(lastVisitKey(`${NODE}/`)).toBe(lastVisitKey(NODE));
  });

  it('treats a corrupt entry as a cold start', () => {
    localStorage.setItem(lastVisitKey(NODE), '{not json');
    expect(readLastVisit(NODE)).toEqual({});
    localStorage.setItem(lastVisitKey(NODE), '"a string"');
    expect(readLastVisit(NODE)).toEqual({});
  });

  it('is forgotten on every node at logout, and nothing else is', () => {
    rememberTeam(NODE, 'team-a');
    rememberVault('http://other-node:2528', 'team-b', 'ctx-2');
    localStorage.setItem('mero-pass:theme', 'dark');
    forgetLastVisits();
    expect(readLastVisit(NODE)).toEqual({});
    expect(readLastVisit('http://other-node:2528')).toEqual({});
    expect(localStorage.getItem('mero-pass:theme')).toBe('dark');
  });

  it('resumes the remembered team only while the node still lists it', () => {
    expect(pickTeam(['team-a', 'team-b'], 'team-b')).toBe('team-b');
    // Left the team since: the list, not a team screen that can only fail.
    expect(pickTeam(['team-a'], 'team-b')).toBeNull();
  });

  it('never guesses a team: nothing remembered is the list', () => {
    expect(pickTeam(['team-a', 'team-b'], undefined)).toBeNull();
  });

  it('resumes a vault only while its team still lists it', () => {
    expect(pickVault(['ctx-1', 'ctx-2'], 'ctx-2')).toBe('ctx-2');
    expect(pickVault(['ctx-1'], 'ctx-2')).toBeNull();
    expect(pickVault(['ctx-1'], undefined)).toBeNull();
  });
});
