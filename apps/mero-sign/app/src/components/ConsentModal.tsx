import React, { useMemo, useState } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { useTheme } from '../contexts/ThemeContext';
import {
  Button,
  Box,
  Flex,
  Heading,
  Text,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';
interface ConsentModalProps {
  open: boolean;
  userId: string;
  documentId: string;
  agreementContextID?: string;
  agreementContextUserID?: string;
  onAccept: () => void;
  onClose: () => void;
}

const DisclosureText: React.FC<{ mode: string }> = ({ mode }) => (
  <div
    style={{
      maxHeight: '60vh',
      overflowY: 'auto',
      paddingLeft: spacing[2].value,
    }}
  >
    <Text
      style={{
        display: 'block',
        marginBottom: spacing[3].value,
        color: mode === 'dark' ? '#e5e7eb' : '#111827',
      }}
    >
      Please read this Electronic Records Disclosure and Consent (“Disclosure")
      carefully and retain a copy for your records.
    </Text>
    <ol
      style={{ paddingLeft: spacing[4].value, marginBottom: spacing[3].value }}
    >
      <li style={{ marginBottom: spacing[2].value }}>
        You have the right to receive a paper copy of any record that we provide
        to you electronically. If you would like to receive a paper copy of any
        record, you may request it at any time by contacting us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        We may charge a reasonable fee for providing paper copies.
      </li>
      <li style={{ marginBottom: spacing[2].value }}>
        You may withdraw your consent to receive records electronically at any
        time. To withdraw your consent, please notify us in writing at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        There are no fees or penalties for withdrawing your consent. However,
        withdrawing consent may delay the processing of your transaction or
        limit your ability to use certain services.
      </li>
      <li style={{ marginBottom: spacing[2].value }}>
        Your consent applies to all records and disclosures related to your
        transactions with us, including but not limited to contracts,
        agreements, notices, and other communications.
      </li>
      <li style={{ marginBottom: spacing[2].value }}>
        To withdraw your consent or to update your electronic contact
        information (such as your email address), please contact us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        It is your responsibility to provide us with a true, accurate, and
        complete email address and to maintain and update promptly any changes
        in this information.
      </li>
      <li style={{ marginBottom: spacing[2].value }}>
        To request a paper copy of a record, contact us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        Please specify which record(s) you would like to receive. A reasonable
        fee may apply for each paper copy requested.
      </li>
      <li style={{ marginBottom: spacing[2].value }}>
        To access and retain electronic records, you will need: a device with
        internet access, a current web browser, a valid email address, software
        capable of viewing PDFs, and sufficient storage or printing capability.
      </li>
      <li>
        By checking the box below and clicking “I Agree,” you acknowledge that
        you have read and understand this Disclosure, confirm that you are able
        to access and retain electronic records, and consent to receive records
        electronically.
      </li>
    </ol>
  </div>
);

const ConsentModal: React.FC<ConsentModalProps> = ({
  open,
  userId,
  documentId,
  agreementContextID,
  agreementContextUserID,
  onAccept,
  onClose,
}) => {
  const { mode } = useTheme();
  const [checked, setChecked] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { app } = useCalimero();
  const api = useMemo(() => new ClientApiDataSource(app), [app]);
  if (!open) return null;

  const handleAccept = async () => {
    setLoading(true);
    setError(null);

    const resp = await api.setConsent(
      userId,
      documentId,
      agreementContextID,
      agreementContextUserID,
    );

    if (resp.error) {
      setError(resp.error.message);
      setLoading(false);
    } else {
      setLoading(false);
      onAccept();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.5)',
      }}
    >
      {/* Disclosure Modal */}
      {showDisclosure && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          <Box
            style={{
              padding: spacing[6].value,
              borderRadius: radius.lg.value,
              maxWidth: '32rem',
              width: '100%',
              border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
              boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
            }}
          >
            <Heading
              size="sm"
              style={{
                marginBottom: spacing[4].value,
                color: mode === 'dark' ? '#f3f4f6' : 'inherit',
              }}
            >
              Electronic Records Disclosure and Consent
            </Heading>
            <DisclosureText mode={mode} />
            <Flex
              justifyContent="flex-end"
              style={{ marginTop: spacing[6].value }}
            >
              <Button
                variant="secondary"
                onClick={() => setShowDisclosure(false)}
              >
                Close
              </Button>
            </Flex>
          </Box>
        </div>
      )}

      {/* Main Consent Modal */}
      <Box
        style={{
          padding: spacing[6].value,
          borderRadius: radius.lg.value,
          maxWidth: '28rem',
          width: '100%',
          border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
          backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
        }}
      >
        <Heading
          size="md"
          style={{
            marginBottom: spacing[4].value,
            color: mode === 'dark' ? '#f3f4f6' : 'inherit',
          }}
        >
          Consent to Electronic Signing
        </Heading>
        <Text
          style={{
            marginBottom: spacing[4].value,
            color: mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
            fontSize: '0.95rem',
          }}
        >
          Before signing, you must agree to conduct business electronically.{' '}
          <button
            type="button"
            style={{ textDecoration: 'underline', color: 'var(--primary)' }}
            onClick={() => setShowDisclosure(true)}
          >
            Click to view agreement to conduct business
          </button>
          .
        </Text>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: spacing[4].value,
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => setChecked(!checked)}
            style={{ marginRight: spacing[3].value }}
          />
          <Text>
            I agree to receive records electronically in accordance with this
            Disclosure.
          </Text>
        </label>
        {error && (
          <div
            style={{
              color: colors.semantic.error.value,
              marginBottom: spacing[3].value,
            }}
          >
            {error}
          </div>
        )}

        <Flex
          justifyContent="flex-end"
          style={{ gap: spacing[3].value, marginTop: spacing[4].value }}
        >
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={handleAccept}
            disabled={!checked || loading}
          >
            {loading ? 'Saving...' : 'Continue to Sign'}
          </Button>
        </Flex>
      </Box>
    </div>
  );
};
export default ConsentModal;
