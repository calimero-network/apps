import React, { useMemo, useState } from 'react';
import { useCalimero } from '../lib/useCalimero';
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { ShieldCheck } from 'lucide-react';
import GlassDialog from './ui/GlassDialog';
import ui from './ui/controls.module.css';
import styles from './ConsentModal.module.css';
interface ConsentModalProps {
  open: boolean;
  // ⚠️ No `userId`. Consent is recorded for the caller's own account inside the
  // contract; this modal used to pass `agreementContextUserID` — the context
  // member DEVICE key — into a `set_consent` that stored it unchecked, which is
  // both how consent was recorded against the wrong identity and how one member
  // could consent on another's behalf.
  documentId: string;
  agreementContextID?: string;
  agreementContextUserID?: string;
  onAccept: () => void;
  onClose: () => void;
}

const DisclosureText: React.FC = () => (
  <div className={styles.disclosure}>
    <p className={styles.lead}>
      Please read this Electronic Records Disclosure and Consent (“Disclosure")
      carefully and retain a copy for your records.
    </p>
    <ol className={styles.list}>
      <li>
        You have the right to receive a paper copy of any record that we provide
        to you electronically. If you would like to receive a paper copy of any
        record, you may request it at any time by contacting us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        We may charge a reasonable fee for providing paper copies.
      </li>
      <li>
        You may withdraw your consent to receive records electronically at any
        time. To withdraw your consent, please notify us in writing at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        There are no fees or penalties for withdrawing your consent. However,
        withdrawing consent may delay the processing of your transaction or
        limit your ability to use certain services.
      </li>
      <li>
        Your consent applies to all records and disclosures related to your
        transactions with us, including but not limited to contracts,
        agreements, notices, and other communications.
      </li>
      <li>
        To withdraw your consent or to update your electronic contact
        information (such as your email address), please contact us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        It is your responsibility to provide us with a true, accurate, and
        complete email address and to maintain and update promptly any changes
        in this information.
      </li>
      <li>
        To request a paper copy of a record, contact us at{' '}
        <a href="mailto:support@calimero.network">support@calimero.network</a>.
        Please specify which record(s) you would like to receive. A reasonable
        fee may apply for each paper copy requested.
      </li>
      <li>
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
  documentId,
  agreementContextID,
  agreementContextUserID,
  onAccept,
  onClose,
}) => {
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
    <>
      <GlassDialog
        open
        onClose={onClose}
        title="Consent to electronic signing"
        size="sm"
        testId="consent-dialog"
        footer={
          <>
            <button
              type="button"
              className={ui.ghost}
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className={ui.success}
              onClick={handleAccept}
              disabled={!checked || loading}
              data-testid="consent-accept"
            >
              {loading ? <span className={ui.spinner} /> : null}
              {loading ? 'Saving…' : 'Continue to sign'}
            </button>
          </>
        }
      >
        <div className={styles.body}>
          <span className={styles.icon} aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <p className={styles.text}>
            Before signing, you must agree to conduct business electronically.{' '}
            <button
              type="button"
              className={styles.link}
              onClick={() => setShowDisclosure(true)}
            >
              Read the agreement to conduct business electronically
            </button>
            .
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => setChecked(!checked)}
              data-testid="consent-checkbox"
            />
            <span>
              I agree to receive records electronically in accordance with
              this Disclosure.
            </span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </GlassDialog>

      {/* The disclosure, over the consent dialog */}
      <GlassDialog
        open={showDisclosure}
        onClose={() => setShowDisclosure(false)}
        title="Electronic Records Disclosure and Consent"
        size="lg"
        layer="top"
        footer={
          <button
            type="button"
            className={ui.ghost}
            onClick={() => setShowDisclosure(false)}
          >
            Close
          </button>
        }
      >
        <DisclosureText />
      </GlassDialog>
    </>
  );
};

export default ConsentModal;
