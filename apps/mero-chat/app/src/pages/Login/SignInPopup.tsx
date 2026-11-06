import { useEffect, useState } from "react";

import BaseModal from "../../components/common/popups/BaseModal";
import { useCalimero } from "../../api/calimero";
import { pendingInvite } from "../../utils/invitation";
import SignInPanel from "./SignInPanel";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect popup (a node URL, node login, the Cloud wallet): on Calimero 1.0
 * the build already names its cluster (`merod local` in dev, the Cloud
 * cluster in production) and an account is a passkey.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignInPopup({ isOpen, onClose }: Props) {
  const { status } = useCalimero();
  const [busy, setBusy] = useState(false);
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (isOpen && status === "signed-in") onClose();
  }, [isOpen, status, onClose]);

  return (
    <BaseModal
      toggle={<span />}
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      content={<SignInPanel invited={invited} onBusy={setBusy} />}
    />
  );
}
