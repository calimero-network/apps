// Sample workspace for the dev-only layout gallery, copied from the approved
// mockup's DOCS / TC / FC tables so every gallery section renders the same data.

export const WORKSPACE_NAME = 'Acme Product';

export interface WorkspaceFolder {
  name: string;
  color: string | null;
  parent?: string;
}

export const FOLDERS: WorkspaceFolder[] = [
  { name: 'Product', color: '#3b82f6' },
  { name: 'Design', color: '#8b5cf6' },
  { name: 'Engineering', color: '#10b981' },
  { name: 'Marketing', color: '#f59e0b' },
  { name: 'Finance', color: '#ef4444' },
  { name: 'Specs', color: null, parent: 'Engineering' },
];

export interface WorkspaceTag {
  name: string;
  color: string;
}

export const TAGS: WorkspaceTag[] = [
  { name: 'roadmap', color: '#3b82f6' },
  { name: 'design', color: '#8b5cf6' },
  { name: 'api', color: '#10b981' },
  { name: 'launch', color: '#f59e0b' },
  { name: 'q3', color: '#64748b' },
  { name: 'pricing', color: '#ec4899' },
  { name: 'ops', color: '#ef4444' },
  { name: 'brand', color: '#14b8a6' },
];

export interface WorkspacePerson {
  initials: string;
  color: string;
}

const BOB: WorkspacePerson = { initials: 'BO', color: '#ef4444' };
const ALICE: WorkspacePerson = { initials: 'AL', color: '#8b5cf6' };

export interface WorkspaceDoc {
  title: string;
  folders: string[];
  tags: string[];
  updatedLabel: string;
  updatedBy: string;
  live?: boolean;
  whoIsHere?: WorkspacePerson[];
}

export const DOCS: WorkspaceDoc[] = [
  {
    title: 'Q3 launch plan',
    folders: ['Product'],
    tags: ['roadmap', 'q3'],
    whoIsHere: [BOB],
    live: true,
    updatedLabel: '2 min ago',
    updatedBy: 'Bob',
  },
  {
    title: 'API spec v2',
    folders: ['Engineering', 'Specs'],
    tags: ['api', 'design'],
    whoIsHere: [ALICE],
    updatedLabel: '18 min ago',
    updatedBy: 'Alice',
  },
  {
    title: 'Brand guidelines',
    folders: ['Design'],
    tags: ['design', 'brand'],
    updatedLabel: '1 h ago',
    updatedBy: 'Kim',
  },
  {
    title: 'Roadmap 2026',
    folders: ['Product'],
    tags: ['roadmap'],
    updatedLabel: 'Yesterday',
    updatedBy: 'You',
  },
  {
    title: 'Launch blog post',
    folders: ['Marketing'],
    tags: ['launch', 'q3'],
    updatedLabel: 'Yesterday',
    updatedBy: 'Kim',
  },
  {
    title: 'Design review notes',
    folders: ['Design'],
    tags: ['design'],
    updatedLabel: 'Sep 22',
    updatedBy: 'Alice',
  },
  {
    title: 'Pricing notes',
    folders: ['Product'],
    tags: ['pricing'],
    updatedLabel: 'Sep 20',
    updatedBy: 'You',
  },
  {
    title: 'Incident runbook',
    folders: ['Engineering'],
    tags: ['ops'],
    updatedLabel: 'Sep 17',
    updatedBy: 'Bob',
  },
  {
    title: 'Budget FY27',
    folders: ['Finance'],
    tags: [],
    updatedLabel: 'Sep 12',
    updatedBy: 'You',
  },
  {
    title: 'Onboarding checklist',
    folders: ['Marketing'],
    tags: [],
    updatedLabel: 'Sep 8',
    updatedBy: 'Kim',
  },
];
