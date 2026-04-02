import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Grid,
  GridItem,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
} from '@calimero-network/mero-ui';
import { useMero } from '@calimero-network/mero-react';
import translations from '../../constants/en.global.json';

export default function Authenticate() {
  const navigate = useNavigate();
  const { isAuthenticated, connectToNode } = useMero();
  const [nodeUrl, setNodeUrl] = useState(
    import.meta.env.VITE_NODE_URL || 'http://localhost:4001',
  );

  useEffect(() => {
    if (isAuthenticated) {
      const currentPath = window.location.pathname;
      if (
        currentPath === '/' ||
        currentPath === '' ||
        currentPath === '/index.html'
      ) {
        navigate('/home', { replace: true });
      }
    }
  }, [isAuthenticated, navigate]);

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="Shared Counter" />
        <NavbarMenu align="right">
          <NavbarItem>
            <div
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
            >
              <Input
                type="text"
                value={nodeUrl}
                onChange={(e) => setNodeUrl(e.target.value)}
                placeholder="http://localhost:4001"
                style={{ width: '220px', fontSize: '0.85rem' }}
              />
              <Button variant="primary" onClick={() => connectToNode(nodeUrl)}>
                Connect
              </Button>
            </div>
          </NavbarItem>
        </NavbarMenu>
      </MeroNavbar>
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#111111',
          color: 'white',
        }}
      >
        <Grid
          columns={12}
          gap={16}
          maxWidth="100%"
          justify="center"
          align="center"
          style={{ minHeight: '100vh', padding: '2rem 1rem' }}
        >
          <GridItem colSpan={12} colStart={1}>
            <main
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '80vh',
              }}
            >
              <div style={{ width: '100%', maxWidth: '800px' }}>
                <Card
                  variant="rounded"
                  style={{
                    background:
                      'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
                    border: '1px solid #4b5563',
                    boxShadow:
                      '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  <CardHeader
                    style={{
                      background:
                        'linear-gradient(135deg, #374151 0%, #4b5563 100%)',
                      borderBottom: '1px solid #6b7280',
                      padding: '1.5rem',
                    }}
                  >
                    <CardTitle
                      style={{
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        background:
                          'linear-gradient(135deg, #ffffff 0%, #e5e7eb 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textAlign: 'center',
                        margin: 0,
                      }}
                    >
                      {translations.auth.description.subtitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent style={{ padding: '1.5rem' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div
                        style={{
                          background: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          borderRadius: '8px',
                          padding: '1rem',
                          marginBottom: '1rem',
                        }}
                      >
                        <p
                          style={{
                            color: '#e5e7eb',
                            marginBottom: 0,
                            fontSize: '1rem',
                            lineHeight: '1.5',
                            textAlign: 'center',
                            fontWeight: '500',
                          }}
                        >
                          {translations.home.demoDescription}
                        </p>
                      </div>

                      <div
                        style={{
                          background: 'rgba(79, 70, 229, 0.08)',
                          border: '1px solid rgba(79, 70, 229, 0.25)',
                          borderRadius: '8px',
                          padding: '1rem',
                        }}
                      >
                        <h3
                          style={{
                            color: '#4F46E5',
                            marginBottom: '1rem',
                            fontSize: '1.1rem',
                            textAlign: 'center',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Key Features
                        </h3>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: '0.75rem',
                            maxWidth: '700px',
                            margin: '0 auto',
                          }}
                        >
                          {translations.auth.description.features.map(
                            (feature, index) => (
                              <div
                                key={index}
                                style={{
                                  background: 'rgba(79, 70, 229, 0.08)',
                                  border: '1px solid rgba(79, 70, 229, 0.25)',
                                  borderRadius: '6px',
                                  padding: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                }}
                              >
                                <div
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    background:
                                      'linear-gradient(135deg, #4F46E5 0%, #6366f1 100%)',
                                    flexShrink: 0,
                                  }}
                                />
                                <span
                                  style={{
                                    color: '#e5e7eb',
                                    fontSize: '0.85rem',
                                    lineHeight: '1.4',
                                    fontWeight: '500',
                                  }}
                                >
                                  {feature}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                        marginTop: '1.5rem',
                        padding: '1rem',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <Button
                        variant="primary"
                        onClick={() =>
                          window.open(
                            'https://docs.calimero.network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                        }}
                      >
                        {translations.home.documentation}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          window.open(
                            'https://github.com/calimero-network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                        }}
                      >
                        {translations.home.github}
                      </Button>
                      <Button
                        variant="info"
                        onClick={() =>
                          window.open(
                            'https://calimero.network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                        }}
                      >
                        {translations.home.website}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
