import type { AppView, EnrolmentView, GroupView, PlacementView } from "../backend";

/** Subgroup metadata key holding the org group id. */
export const ORG_GROUP_KEY = "org-group";
/** Subgroup metadata key holding the org namespace id. */
export const ORG_KEY = "org";

export interface ObservedSubgroup {
  groupId: string;
  name: string;
  orgGroupId: string | null;
  members: Set<string>;
}

export interface ObservedApp {
  appId: string;
  rootMembers: Set<string>;
  subgroups: ObservedSubgroup[];
}

export type PlannedOp =
  | { kind: "create-subgroup"; app: string; orgGroupId: string; name: string }
  | { kind: "mint-invitation"; app: string; account: string }
  | { kind: "add-member"; app: string; subgroupId: string; orgGroupId: string; account: string; capabilities: number }
  | { kind: "remove-member"; app: string; subgroupId: string; orgGroupId: string; account: string }
  | { kind: "record"; account: string; app: string; state: string; subgroups: string[]; note: string };

export interface PlanInput {
  orgNamespaceId: string;
  now: number;
  placements: PlacementView[];
  enrolments: EnrolmentView[];
  groups: GroupView[];
  apps: AppView[];
  observed: ObservedApp[];
  /** accounts whose org status is `left`: removed from every app namespace root */
  leftAccounts: string[];
}
