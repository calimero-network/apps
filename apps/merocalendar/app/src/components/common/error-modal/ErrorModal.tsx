import React, { FC } from 'react';
import styles from './error-modal.module.scss';
import { useAuth } from '../../../hooks/useAuth';

interface IErrorModalProps {
  message: string;
  closeError: () => void;
  errorType: 'websocket' | 'create' | 'edit' | 'delete';
}

const ErrorModal: FC<IErrorModalProps> = ({
  message,
  closeError,
  errorType,
}) => {
  const { logout } = useAuth();

  const handleCloseError = () => {
    if (errorType === 'websocket') {
      closeError();
      logout();
      window.location.href = '/plantr/login';
    } else {
      closeError();
      window.location.reload();
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.errorModal}>
        <div className={styles.errorModal__content}>
          <h2 className={styles.errorModal__title}>An Error Occurred</h2>
          <div className={styles.errorModal__message}>{message}</div>
          <button
            className={styles.errorModal__closeButton}
            onClick={handleCloseError}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
