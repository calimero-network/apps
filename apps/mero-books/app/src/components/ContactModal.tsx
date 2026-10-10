import React, { useState } from 'react';
import type { ContactView } from '../generated/BooksClient';
import type { BooksClient } from '../generated/BooksClient';
import { describeError } from '../utils/errors';
import { Button, ErrorText, FieldGrid, Input, Label, Modal, TextArea } from './ui';

/** Create a contact, or edit one. Resolves with the contact's id. */
export default function ContactModal({
  contact, initialName = '', act, onClose, onSaved,
}: {
  contact?: ContactView;
  initialName?: string;
  act: <T>(fn: (c: BooksClient) => Promise<T>) => Promise<T>;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(contact?.name ?? initialName);
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [taxNumber, setTaxNumber] = useState(contact?.tax_number ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setError('A contact needs a name.'); return; }
    setBusy(true);
    setError(null);
    try {
      const fields = { name, email, phone, address, tax_number: taxNumber };
      const id = await act(async (c) => {
        if (contact) {
          await c.updateContact({ contact_id: contact.id, ...fields });
          return contact.id;
        }
        return c.createContact(fields);
      });
      onSaved?.(id);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={contact ? 'Edit contact' : 'New contact'} onClose={onClose} testId="contact-modal">
      <Label>
        Name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="contact-name" placeholder="Business or person" />
      </Label>
      <FieldGrid>
        <Label>
          Email
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="contact-email" />
        </Label>
        <Label>
          Phone
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Label>
      </FieldGrid>
      <Label>
        Address
        <TextArea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Label>
      <Label>
        Tax number
        <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder="VAT / GST / EIN" />
      </Label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="actions">
        <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" $variant="primary" onClick={save} disabled={busy} data-testid="contact-save">
          {busy ? 'Saving…' : 'Save contact'}
        </Button>
      </div>
    </Modal>
  );
}
