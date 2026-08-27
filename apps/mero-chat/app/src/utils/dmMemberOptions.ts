import type { GroupMember } from "../api/groupApi";
import { shortAccount } from "./accountIdentity";

/**
 * The people you can start a DM with, as account -> label.
 *
 * Members without a display name are INCLUDED, shown as a truncated account.
 * They used to be dropped:
 *
 *     const label = member.alias?.trim() || labels.get(member.identity) || "";
 *     if (!label) return;
 *
 * which made anyone who had not set a name unreachable — not greyed out or
 * marked unnamed, simply absent from the picker, with nothing to explain why.
 * A name is a label someone chooses; letting its absence delete a person from
 * the list is the same mistake as treating a name as an identity, from the
 * other side.
 *
 * The account is always true, so it is the honest fallback — and it is what
 * the DM will be keyed on regardless.
 */
export function buildDmMemberOptions(params: {
  groupMembers: GroupMember[];
  currentMemberIdentity: string;
  labelsByIdentity: Map<string, string>;
}): Map<string, string> {
  const options = new Map<string, string>();

  params.groupMembers.forEach((member) => {
    if (!member.identity || member.identity === params.currentMemberIdentity) {
      return;
    }

    const label =
      member.alias?.trim() ||
      params.labelsByIdentity.get(member.identity) ||
      shortAccount(member.identity);
    options.set(member.identity, label);
  });

  return options;
}
