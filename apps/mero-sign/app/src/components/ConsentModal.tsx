import React, { useMemo, useState } from 'react';
import { Button } from './ui/button';
import { useCalimero } from '@calimero-network/calimero-client';
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { useTheme } from '../contexts/ThemeContext';
interface ConsentModalProps {
  open: boolean;
  userId: string;
  documentId: string;
  agreementContextID?: string;
  agreementContextUserID?: string;
  onAccept: () => void;
  onClose: () => void;
}

const DisclosureText = () => (
  <div className="space-y-3 text-sm text-foreground max-h-[60vh] overflow-y-auto px-1">
    <p>
      Please read this Electronic Records Disclosure and Consent (“Disclosure”)
      carefully and retain a copy for your records.
    </p>
    <ol className="list-decimal pl-5 space-y-2">
      <li>
        You have the right to receive a paper copy of any record that we provide
        to you electronically. If you would like to receive a paper copy of any
        record, you may request it at any time by contacting us at{' '}
        <a href="mailto:support@calimero.network" className="underline">
          support@calimero.network
        </a>
        . We may charge a reasonable fee for providing paper copies.
      </li>
      <li>
        You may withdraw your consent to receive records electronically at any
        time. To withdraw your consent, please notify us in writing at{' '}
        <a href="mailto:support@calimero.network" className="underline">
          support@calimero.network
        </a>
        . There are no fees or penalties for withdrawing your consent. However,
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
        <a href="mailto:support@calimero.network" className="underline">
          support@calimero.network
        </a>
        . It is your responsibility to provide us with a true, accurate, and
        complete email address and to maintain and update promptly any changes
        in this information.
      </li>
      <li>
        To request a paper copy of a record, contact us at{' '}
        <a href="mailto:support@calimero.network" className="underline">
          support@calimero.network
        </a>
        . Please specify which record(s) you would like to receive. A reasonable
        fee may apply for each paper copy requested.
      </li>
      <li>
        To access and retain electronic records, you will need:
        <ul className="list-disc pl-5 mt-1 space-y-1">
          <li>
            A device with internet access (such as a computer, tablet, or
            smartphone)
          </li>
          <li>
            A current version of a web browser (such as Chrome, Firefox, Safari,
            or Edge)
          </li>
          <li>A valid email address</li>
          <li>
            Software capable of viewing PDF files (such as Adobe Acrobat Reader)
          </li>
          <li>
            Sufficient storage space to save electronic records or the ability
            to print them
          </li>
        </ul>
        If these requirements change in a way that creates a material risk that
        you may not be able to access or retain electronic records, we will
        notify you of the new requirements and provide you with the opportunity
        to withdraw your consent without penalty.
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999]">
      {/* Disclosure Modal */}
      {showDisclosure && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000] bg-black/60">
          <div
            className={`p-6 rounded-lg max-w-lg w-full border shadow-lg relative ${
              mode === 'dark' ? 'bg-gray-900' : 'bg-white'
            }`}
          >
            <h2 className="text-lg font-semibold mb-4">
              Electronic Records Disclosure and Consent
            </h2>
            <DisclosureText />
            <div
              className={`flex justify-end mt-6 ${mode === 'dark' ? 'text-black' : ''}`}
            >
              <Button onClick={() => setShowDisclosure(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Consent Modal */}
      <div
        className={`p-6 rounded-lg max-w-md w-full border shadow-lg ${mode === 'dark' ? 'bg-gray-900' : 'bg-white'}`}
      >
        <h2 className="text-lg font-semibold mb-4">
          Consent to Electronic Signing
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Before signing, you must agree to conduct business electronically.{' '}
          <button
            type="button"
            className="underline text-primary hover:text-primary/80"
            onClick={() => setShowDisclosure(true)}
          >
            Click to view agreement to conduct business
          </button>
          .
        </p>
        <label className="flex items-center mb-4">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => setChecked(!checked)}
            className="mr-2"
          />
          I agree to receive records electronically in accordance with this
          Disclosure.
        </label>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <div className="flex justify-end space-x-2 ">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!checked || loading}
            className={`${mode === 'dark' ? 'text-black' : 'text-white'}`}
          >
            {loading ? 'Saving...' : 'Continue to Sign'}
          </Button>
        </div>
      </div>
    </div>
  );
};
export default ConsentModal;
