import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberCard, memberCardProps } from '../MemberCard';

const BOB = 'b0'.repeat(32);
const target = { ws: 'w1', member: BOB };

function data(over: Partial<Parameters<typeof memberCardProps>[1]> = {}) {
  return {
    ws: 'w1',
    members: [BOB],
    name: 'Robert',
    role: 'Editor',
    canOpen: true,
    ...over,
  };
}

describe('memberCardProps', () => {
  it('shows the current name and role, not the text the mention was typed with', () => {
    expect(memberCardProps(target, data())).toEqual({
      state: 'ok',
      id: BOB,
      name: 'Robert',
      role: 'Editor',
      access: 'yes',
    });
  });

  it('says when they cannot open this folder, and stays quiet while unknown', () => {
    expect(memberCardProps(target, data({ canOpen: false }))).toMatchObject({
      access: 'no',
    });
    expect(memberCardProps(target, data({ canOpen: undefined }))).toMatchObject(
      { access: 'unknown' },
    );
  });

  it('says when they have left the workspace, once the member list is read', () => {
    expect(memberCardProps(target, data({ members: [] }))).toMatchObject({
      access: 'left',
    });
    expect(memberCardProps(target, data({ members: null }))).toMatchObject({
      access: 'yes',
    });
  });

  it('flags a mention from another workspace', () => {
    expect(memberCardProps({ ...target, ws: 'w2' }, data())).toEqual({
      state: 'other-workspace',
    });
  });
});

describe('MemberCard', () => {
  it('draws initials, name, role and folder access', () => {
    render(
      <MemberCard
        state="ok"
        id={BOB}
        name="Robert Tables"
        role="Editor"
        access="no"
      />,
    );
    expect(screen.getByText('RT').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Robert Tables')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText("Can't open this folder")).toBeTruthy();
  });

  it.each([
    ['yes', 'Can open this folder'],
    ['left', 'Not in this workspace'],
  ] as const)('reads %s access', (access, text) => {
    render(<MemberCard state="ok" id={BOB} name="Bob" access={access} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('leaves access out while it is unknown', () => {
    const { container } = render(
      <MemberCard state="ok" id={BOB} name="Bob" access="unknown" />,
    );
    expect(container.textContent).toBe('BOBob');
  });

  it('says a mention points into another workspace', () => {
    render(<MemberCard state="other-workspace" />);
    expect(
      screen.getByText('This mentions someone in another workspace'),
    ).toBeTruthy();
  });
});
