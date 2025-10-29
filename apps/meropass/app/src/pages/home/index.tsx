import React from 'react';
import { useCalimero, CalimeroConnectButton, ConnectionType } from '@calimero-network/calimero-client';
import { Navbar as MeroNavbar, NavbarBrand, NavbarMenu, NavbarItem } from '@calimero-network/mero-ui';
import VaultList from './VaultList';

const HomePage: React.FC = () => {
  const { identity } = useCalimero();

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="MeroPass" />
        <NavbarMenu align="right">
          <NavbarItem>
            <CalimeroConnectButton
              connectionType={{
                type: ConnectionType.Custom,
                url: 'http://node1.127.0.0.1.nip.io',
              }}
            />
          </NavbarItem>
        </NavbarMenu>
      </MeroNavbar>
      
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900">
                MeroPass
              </h1>
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