import { useNavigate } from 'react-router-dom';
import { ConnectButton } from '@calimero-network/mero-react';
import {
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarItem,
  NavbarMenu,
} from '@calimero-network/mero-ui';

/**
 * The app bar, in one place.
 *
 * It was pasted into three render branches of the vault page alone, plus the
 * home page, each carrying its own copy of the ConnectButton. Four copies is
 * four chances for them to drift; the brand is also a link home now, which none
 * of the copies were — the vault page had no way back to the vault list at all.
 *
 * ⚠️ No hard-coded node URL on the ConnectButton. One of these copies said
 * `http://node1.127.0.0.1.nip.io`, a developer's local node, so every user of a
 * deployed build was pointed at a machine that is not theirs.
 */
export default function PassNavbar() {
  const navigate = useNavigate();
  return (
    <MeroNavbar variant="elevated" size="md">
      {/* `text` is typed as a string, so the brand is made clickable with
          `onClick` rather than by nesting a <Link> in it. */}
      <NavbarBrand text="Mero Pass" onClick={() => navigate('/home')} />
      <NavbarMenu align="right">
        <NavbarItem>
          <ConnectButton label="Connect a node" />
        </NavbarItem>
      </NavbarMenu>
    </MeroNavbar>
  );
}
