import React from 'react';
import { ConnectButton } from '@calimero-network/mero-react';
import {
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
} from '@calimero-network/mero-ui';
import VaultList from './VaultList';

const HomePage: React.FC = () => {
  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="MeroPass" />
        <NavbarMenu align="right">
          <NavbarItem>
            {/* No hard-coded node URL. This said
                `http://node1.127.0.0.1.nip.io`, a developer's local node, so
                every user of a deployed build was pointed at a machine that is
                not theirs. mero-react's ConnectButton asks for the node. */}
            <ConnectButton label="Connect a node" />
          </NavbarItem>
        </NavbarMenu>
      </MeroNavbar>

      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900">MeroPass</h1>
              <p className="text-gray-600">
                Secure secret management for teams
              </p>
            </div>

            <VaultList />
          </div>
        </div>
      </div>
    </>
  );
};

export default HomePage;
