import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import {
  getAppEndpointKey,
  getApplicationId,
  setAccessToken,
  setAppEndpointKey,
  setApplicationId,
  setRefreshToken,
} from '@calimero-network/calimero-client';
import plantrLogo from '../../assets/plantrlogo.svg';

import styles from './login.module.scss';

export const LoginPage = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>("");
  const [isDisabled, setIsDisabled] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const MINIMUM_LOADING_TIME_MS = 1000;

  useEffect(() => {
    setUrl(getAppEndpointKey());
    setAppId(getApplicationId());
  }, []);

  function validateUrl(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function validateContext(value: string) {
    if (value.length < 32 || value.length > 44) {
      setApplicationError(
        'Application ID must be between 32 and 44 characters long.',
      );
      return;
    }
    const validChars =
      /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

    if (!validChars.test(value)) {
      setApplicationError(
        'Application ID must contain only base58 characters.',
      );
      return;
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

  const handleChangeContextId = (value: string) => {
    setApplicationError('');
    setAppId(value);
    validateContext(value);
  };

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
            console.log(response);
            if (response.data) {
              setLoginError('');
              setAppEndpointKey(url);
              setApplicationId(appId || '');
              redirectToDashboardLogin();
            } else {
              setLoginError('Connection failed. Please check if node url is correct.');
            }
          })
          .catch(() => {
            setLoginError('Connection failed. Please check if node url is correct.');
          })
          .finally(() => {
            setLoading(false);
          });
      } catch (e) {
        setLoginError('Connection failed. Please check if node url is correct.');
        setLoading(false);
      }
    } else {
      setLoginError('Connection failed. Please check if node url is correct.');
    }
  }, [url, appId]);

  useEffect(() => {
    let status = !url || !appId || !!applicationError || !validateUrl(url) || loading; 
    setIsDisabled(status);
  }, [url, appId, applicationError, loading]);

  const redirectToDashboardLogin = () => {
    const nodeUrl = getAppEndpointKey();
    const applicationId = getApplicationId();
    if (!nodeUrl) {
      setLoginError('Node URL is not set');
      return;
    }
    if (!applicationId) {
      setLoginError('Application ID is not set');
      return;
    }

    const callbackUrl = encodeURIComponent(window.location.href);
    const redirectUrl = `${nodeUrl}/admin-dashboard/?application_id=${applicationId}&callback_url=${callbackUrl}`;

    window.location.href = redirectUrl;
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedAccessToken = urlParams.get('access_token');
    const encodedRefreshToken = urlParams.get('refresh_token');
    if (encodedAccessToken && encodedRefreshToken) {
      const accessToken = decodeURIComponent(encodedAccessToken);
      const refreshToken = decodeURIComponent(encodedRefreshToken);
      setAccessToken(accessToken);
      setRefreshToken(refreshToken);
      navigate('/');
    }
  }, []);

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
          <div>
            <div id="input-item" className={styles.configWrapper__inputItem}>
              <label className={styles.configWrapper__label}>
                Application ID
              </label>
              <div className={styles.paddingWrap}>
                <input
                  type="text"
                  placeholder="application id"
                  value={appId || ''}
                  onChange={(e) => handleChangeContextId(e.target.value)}
                  aria-invalid={!!applicationError}
                  aria-describedby="appIdError"
                  className={styles.configWrapper__inputField}
                />
              </div>
              <div className={styles.configWrapper__error}>
                {applicationError}
              </div>
            </div>
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
              <div className={styles.configWrapper__error}>{error || loginError}</div>
            </div>
            <div className={styles.loginButtonWrapper}>
              <div className={loading ? styles.loading : styles.loading__hidden}></div>
              <button
                className={styles.login__btn}
                disabled={isDisabled}
                onClick={checkConnection}
              >
                <span>Login</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
