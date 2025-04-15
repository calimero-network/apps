import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import {
  Context,
  getAppEndpointKey,
  getApplicationId,
  setAppEndpointKey,
  setApplicationId,
  setContextId,
  setExecutorPublicKey,
} from '@calimero-network/calimero-client';
import plantrLogo from '../../assets/plantrlogo.svg';

import styles from './login.module.scss';
import { useAuth } from '../../hooks/useAuth';

enum STEPS {
  ENTER_NODE_URL = 'ENTER NODE URL',
  SELECT_CONTEXT = 'SELECT CONTEXT',
  SELECT_IDENTITY = 'SELECT IDENTITY',
  LOGIN = 'LOGIN',
}

export const LoginPage = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>('');
  const [isDisabled, setIsDisabled] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [availableContexts, setAvailableContexts] = useState<Context[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(
    null,
  );
  const [contextIdentities, setContextIdentities] = useState<string[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>('');

  const MINIMUM_LOADING_TIME_MS = 1000;

  useEffect(() => {
    setUrl(getAppEndpointKey());
    setAppId(getApplicationId() ?? import.meta.env.VITE_APPLICATION_ID);
  }, []);

  function validateUrl(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  const handleChange = (urlValue: string) => {
    if (validateUrl(urlValue)) {
      setError('');
      setUrl(urlValue);
    } else {
      setError('Invalid URL. Please enter a valid URL.');
      setUrl(urlValue);
    }
  };

  const [currentStep, setCurrentStep] = useState(STEPS.ENTER_NODE_URL);

  const checkConnection = useCallback(async () => {
    if (!url) return;
    if (validateUrl(url.toString())) {
      setLoading(true);
      const timer = new Promise((resolve) =>
        setTimeout(resolve, MINIMUM_LOADING_TIME_MS),
      );
      try {
        const fetchData = axios.get(`${url}/admin-api/health`);

        Promise.all([timer, fetchData])
          .then(([, response]) => {
            if (response.data) {
              setLoginError('');
              setAppEndpointKey(url);
              setApplicationId(appId || '');
              fetchAvailableContexts();
              setCurrentStep(STEPS.SELECT_CONTEXT);
            } else {
              setLoginError(
                'Connection failed. Please check if node url is correct.',
              );
            }
          })
          .catch(() => {
            setLoginError(
              'Connection failed. Please check if node url is correct.',
            );
          })
          .finally(() => {
            setLoading(false);
          });
      } catch (e) {
        setLoginError(
          'Connection failed. Please check if node url is correct.',
        );
        setLoading(false);
      }
    } else {
      setLoginError('Connection failed. Please check if node url is correct.');
    }
  }, [url, appId]);

  const fetchAvailableContexts = useCallback(async () => {
    try {
      const response = await axios(`${url}/admin-api/contexts`);
      let appContexts = response.data.data.contexts.filter(
        (context: Context) => context.applicationId === appId,
      );
      setAvailableContexts(appContexts);
    } catch (error) {
      setContextError('Failed to fetch contexts');
    }
  }, [appId]);

  const onSelectContext = (contextId: string) => {
    setSelectedContextId(contextId);
    fetchContextIdentities(contextId);
    setCurrentStep(STEPS.SELECT_IDENTITY);
  };

  const fetchContextIdentities = useCallback(
    async (contextId: string) => {
      try {
        const response = await axios.get(
          `${url}/admin-api/contexts/${contextId}/identities-owned`,
        );
        setContextIdentities(response.data.data.identities);
      } catch (error) {
        console.error('Error deleting context:', error);
        return { error: { code: 500, message: 'Failed to delete context.' } };
      }
    },
    [selectedContextId, url],
  );

  const onSelectIdentity = (identity: string) => {
    setSelectedIdentity(identity);
    setCurrentStep(STEPS.LOGIN);
  };

  const handleLogin = () => {
    if (selectedContextId && selectedIdentity) {
      setContextId(selectedContextId);
      setExecutorPublicKey(selectedIdentity);
      navigate('/');
    }
  };

  useEffect(() => {
    let status =
      !url || !appId || !validateUrl(url) || loading;
    setIsDisabled(status);
  }, [url, appId, loading]);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/');
    }
  }, [isLoggedIn]);

  return (
    <div className={styles.loginWrapper}>
      <div className={styles.loginModal}>
        <div className={styles.loginModal__title}>
          <img
            src={plantrLogo as unknown as string}
            alt="Plantr"
            className={styles.plantrLogo}
          />
          <div className={styles.title}>
            <span className={styles.title__text}>
              Login to start managing your plans
            </span>
          </div>
        </div>
        <div className={styles.configWrapper}>
          <div className={styles.configWrapper__title}>APP CONFIGURATION</div>
          {currentStep === STEPS.ENTER_NODE_URL && (
            <>
              <div id="input-item" className={styles.configWrapper__inputItem}>
                <label className={styles.configWrapper__label}>Node url</label>
                <div className={styles.paddingWrap}>
                  <input
                    type="text"
                    placeholder="node url"
                    inputMode="url"
                    value={url || ''}
                    onChange={(e) => handleChange(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby="urlError"
                    className={styles.configWrapper__inputField}
                  />
                </div>
                <div className={styles.configWrapper__error}>
                  {error || loginError}
                </div>
              </div>
              <div className={styles.loginButtonWrapper}>
                <div
                  className={loading ? styles.loading : styles.loading__hidden}
                ></div>
                <button
                  className={styles.login__btn}
                  disabled={isDisabled}
                  onClick={checkConnection}
                >
                  <span>Login</span>
                </button>
              </div>
            </>
          )}
          {currentStep === STEPS.SELECT_CONTEXT && (
            <>
              <div className={styles.subtitle}>Select context</div>
              <div className={styles.configWrapper__contexts}>
                {availableContexts.length > 0 ? (
                  availableContexts.map((context: Context) => (
                    <div
                      key={context.id}
                      className={styles.configWrapper__context}
                    >
                      <div
                        className={styles.configWrapper__contextName}
                        onClick={() => onSelectContext(context.id)}
                      >
                        {context.id}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.noDataDiv}>
                    No contexts found for this application
                  </div>
                )}
              </div>
              <div className={styles.configWrapper__error}>
                {' '}
                {contextError}{' '}
              </div>
              <button
                className={styles.login__btn}
                onClick={() => setCurrentStep(STEPS.ENTER_NODE_URL)}
              >
                Back
              </button>
            </>
          )}
          {currentStep === STEPS.SELECT_IDENTITY && (
            <>
              <div className={styles.subtitle}>Select identity</div>
              <div className={styles.configWrapper__contexts}>
                {contextIdentities.length > 0 ? (
                  contextIdentities.map((identity: string) => (
                    <div
                      key={identity}
                      className={styles.configWrapper__context}
                    >
                      <div
                        className={styles.configWrapper__contextName}
                        onClick={() => onSelectIdentity(identity)}
                      >
                        {identity}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.noDataDiv}>
                    No identities found for this context
                  </div>
                )}
              </div>
              <div className={styles.configWrapper__error}>
                {' '}
                {contextError}{' '}
              </div>
              <button
                className={styles.login__btn}
                onClick={() => setCurrentStep(STEPS.SELECT_CONTEXT)}
              >
                Back
              </button>
            </>
          )}
          {currentStep === STEPS.LOGIN && (
            <>
              <div className={styles.subtitle}>LOGIN</div>
              <div className={styles.flexWrapper}>
                <span>Selected context:</span>
                <span className={styles.selectedItem}>{selectedContextId}</span>
              </div>
              <div className={styles.flexWrapper}>
                <span>Selected identity:</span>
                <span className={styles.selectedItem}>{selectedIdentity}</span>
              </div>
              <div className={styles.login__btnWrapper}>
                <button
                  className={styles.login__btn}
                  onClick={() => setCurrentStep(STEPS.SELECT_IDENTITY)}
                >
                  Back
                </button>
                <button className={styles.login__btn} onClick={handleLogin}>
                  login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
