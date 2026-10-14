import { useEffect, useState } from "react";

import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";

/**
 * Whether a TEE node backs this namespace.
 *
 * A TEE node is admitted by hardware attestation as a `ReadOnlyTee` or
 * `RelayTee` member; `listMembers` splits those rows into `teeMembers`. Any
 * member may list the namespace's members, so this works for everyone, not
 * only for the admins who can open Workspace Admin.
 *
 * Failures read as "no TEE": the indicator is informational and must never
 * block or break the surface it sits on.
 */
export function useNamespaceTee(groupId: string | null | undefined): boolean {
  const [teeEnabled, setTeeEnabled] = useState(false);

  useEffect(() => {
    setTeeEnabled(false);
    if (!groupId) return;
    let cancelled = false;

    void new GroupApiDataSource()
      .listMembers(groupId)
      .then((resp) => {
        if (!cancelled) setTeeEnabled((resp.data?.teeMembers.length ?? 0) > 0);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return teeEnabled;
}
