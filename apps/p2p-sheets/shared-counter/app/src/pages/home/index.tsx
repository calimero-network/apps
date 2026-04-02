import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Button,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  Grid,
  GridItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  useToast,
  CopyToClipboard,
  Text,
  Menu,
  MenuItem,
  MenuGroup,
} from '@calimero-network/mero-ui';
import translations from '../../constants/en.global.json';
import { useNavigate } from 'react-router-dom';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { SharedCounterClient } from '../../generated/Shared CounterClient';

const PRIMARY = '#4F46E5';
const PRIMARY_DARK = '#3730a3';
const PRIMARY_LIGHT = 'rgba(79, 70, 229, 0.15)';
const PRIMARY_BORDER = 'rgba(79, 70, 229, 0.35)';

export default function HomePage() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    contextId,
    contextIdentity,
    applicationId,
    nodeUrl,
    mero,
    logout,
  } = useMero();
  const { show } = useToast();

  const [counterValue, setCounterValue] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const loadingRef = useRef<boolean>(false);

  const client = useMemo(
    () =>
      mero && contextId && contextIdentity
        ? new SharedCounterClient(mero, contextId, contextIdentity)
        : null,
    [mero, contextId, contextIdentity],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const refreshValue = useCallback(async () => {
    if (loadingRef.current || !client) return;
    loadingRef.current = true;
    try {
      const value = await client.getValue();
      setCounterValue(value);
    } catch (error) {
      console.error('getValue error:', error);
    } finally {
      loadingRef.current = false;
    }
  }, [client]);

  // Initial load
  useEffect(() => {
    if (isAuthenticated && contextId && contextIdentity) {
      refreshValue();
    }
  }, [isAuthenticated, contextId, contextIdentity, refreshValue]);

  // Real-time updates via SSE
  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  const refreshValueRef = useRef(refreshValue);
  refreshValueRef.current = refreshValue;

  useSubscription(contextIds, () => {
    refreshValueRef.current();
  });

  const handleIncrement = useCallback(async () => {
    if (!client || loading) return;
    setLoading(true);
    try {
      await client.increment();
      await refreshValue();
      show({ title: 'Counter incremented', variant: 'success' });
    } catch (error) {
      show({
        title:
          error instanceof Error
            ? error.message
            : translations.home.errors.incrementFailed,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [client, loading, refreshValue, show]);

  const handleDecrement = useCallback(async () => {
    if (!client || loading) return;
    setLoading(true);
    try {
      await client.decrement();
      await refreshValue();
      show({ title: 'Counter decremented', variant: 'success' });
    } catch (error) {
      show({
        title:
          error instanceof Error
            ? error.message
            : translations.home.errors.decrementFailed,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [client, loading, refreshValue, show]);

  const doLogout = useCallback(() => {
    logout();
    window.location.replace('/');
  }, [logout]);

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="Shared Counter" />
        <NavbarMenu align="center">
          {contextId && (
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                alignItems: 'center',
                fontSize: '0.875rem',
                color: '#9ca3af',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {nodeUrl && (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Text size="sm" color="muted">Node:</Text>
                  <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                    {nodeUrl.replace('http://', '').replace('https://', '')}
                  </Text>
                  <CopyToClipboard
                    text={nodeUrl}
                    variant="icon"
                    size="small"
                    successMessage="Node URL copied!"
                  />
                </div>
              )}
              {applicationId && (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Text size="sm" color="muted">App ID:</Text>
                  <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                    {applicationId.slice(0, 8)}...{applicationId.slice(-8)}
                  </Text>
                  <CopyToClipboard
                    text={applicationId}
                    variant="icon"
                    size="small"
                    successMessage="Application ID copied!"
                  />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Text size="sm" color="muted">Context ID:</Text>
                <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                  {contextId.slice(0, 8)}...{contextId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={contextId}
                  variant="icon"
                  size="small"
                  successMessage="Context ID copied!"
                />
              </div>
            </div>
          )}
        </NavbarMenu>
        <NavbarMenu align="right">
          {isAuthenticated ? (
            <Menu variant="compact" size="md">
              <MenuGroup>
                <MenuItem onClick={doLogout}>{translations.home.logout}</MenuItem>
              </MenuGroup>
            </Menu>
          ) : (
            <NavbarItem>
              <Button variant="primary" onClick={() => navigate('/')}>
                Connect
              </Button>
            </NavbarItem>
          )}
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
          columns={1}
          gap={32}
          maxWidth="100%"
          justify="center"
          align="center"
          style={{ minHeight: '100vh', padding: '2rem' }}
        >
          <GridItem>
            <main
              style={{
                width: '100%',
                maxWidth: '480px',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Card
                variant="rounded"
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                  border: `1px solid ${PRIMARY_BORDER}`,
                  boxShadow: `0 0 40px ${PRIMARY_LIGHT}`,
                }}
              >
                <CardHeader
                  style={{
                    background: `linear-gradient(135deg, ${PRIMARY_LIGHT} 0%, rgba(79,70,229,0.05) 100%)`,
                    borderBottom: `1px solid ${PRIMARY_BORDER}`,
                    padding: '1.5rem',
                    textAlign: 'center',
                  }}
                >
                  <CardTitle
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: '#e5e7eb',
                      margin: 0,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Shared Counter
                  </CardTitle>
                </CardHeader>

                <CardContent
                  style={{
                    padding: '2.5rem 2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2rem',
                  }}
                >
                  {/* Counter Display */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '180px',
                      height: '180px',
                      borderRadius: '50%',
                      background: `radial-gradient(circle at center, ${PRIMARY_LIGHT} 0%, rgba(79,70,229,0.03) 70%)`,
                      border: `2px solid ${PRIMARY_BORDER}`,
                      boxShadow: `0 0 30px ${PRIMARY_LIGHT}, inset 0 0 20px rgba(79,70,229,0.05)`,
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          counterValue !== null && Math.abs(counterValue) >= 10000
                            ? '2.5rem'
                            : '4rem',
                        fontWeight: '800',
                        color:
                          counterValue === null
                            ? '#6b7280'
                            : counterValue > 0
                            ? '#a5b4fc'
                            : counterValue < 0
                            ? '#f87171'
                            : '#e5e7eb',
                        fontFamily: 'monospace',
                        lineHeight: 1,
                        transition: 'color 0.2s ease, font-size 0.15s ease',
                      }}
                    >
                      {counterValue === null ? '—' : counterValue}
                    </span>
                  </div>

                  {/* +/- Buttons */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '1.5rem',
                      alignItems: 'center',
                    }}
                  >
                    {/* Decrement */}
                    <button
                      onClick={handleDecrement}
                      disabled={loading || !client}
                      aria-label="Decrement counter"
                      style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        border: `2px solid ${loading || !client ? '#374151' : PRIMARY_BORDER}`,
                        background:
                          loading || !client
                            ? 'rgba(55,65,81,0.3)'
                            : `linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)`,
                        color: loading || !client ? '#6b7280' : '#a5b4fc',
                        fontSize: '2rem',
                        fontWeight: '300',
                        cursor: loading || !client ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        boxShadow:
                          loading || !client
                            ? 'none'
                            : `0 4px 15px rgba(79,70,229,0.3)`,
                        lineHeight: 1,
                        paddingBottom: '2px',
                      }}
                    >
                      −
                    </button>

                    {/* Increment */}
                    <button
                      onClick={handleIncrement}
                      disabled={loading || !client}
                      aria-label="Increment counter"
                      style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        border: `2px solid ${loading || !client ? '#374151' : PRIMARY}`,
                        background:
                          loading || !client
                            ? 'rgba(55,65,81,0.3)'
                            : `linear-gradient(135deg, ${PRIMARY} 0%, ${PRIMARY_DARK} 100%)`,
                        color: loading || !client ? '#6b7280' : '#ffffff',
                        fontSize: '2rem',
                        fontWeight: '300',
                        cursor: loading || !client ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        boxShadow:
                          loading || !client
                            ? 'none'
                            : `0 4px 20px rgba(79,70,229,0.5)`,
                        lineHeight: 1,
                        paddingBottom: '2px',
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Status label */}
                  <Text
                    size="sm"
                    color="muted"
                    style={{ textAlign: 'center', minHeight: '1.25rem' }}
                  >
                    {loading
                      ? 'Updating…'
                      : counterValue === null
                      ? 'Loading counter…'
                      : 'Synced across all peers'}
                  </Text>
                </CardContent>
              </Card>
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
