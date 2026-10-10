import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { APP_ROUTE } from '../../config';
import { MONTH_NAMES } from '../../utils/books';
import { describeError } from '../../utils/errors';
import { Button, ErrorText, FieldGrid, Input, Label, Page, PageHead, Panel, Row, Select } from '../../components/ui';
import { useAppCtx } from './appContext';

/** Organisation details, the financial year, invoice numbering and the lock date. */
export default function SettingsPage(): React.ReactElement {
  const { data } = useAppCtx();
  const toast = useToast();
  const s = data.settings;
  const [form, setForm] = useState(s);
  const [lock, setLock] = useState(s.lock_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow a teammate's change while this form is untouched.
  useEffect(() => { setForm(s); setLock(s.lock_date ?? ''); }, [s]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await data.act((c) => c.updateSettings({
        organisation_name: form.organisation_name,
        currency: form.currency,
        fy_end_month: form.fy_end_month,
        invoice_prefix: form.invoice_prefix,
        payment_terms_days: form.payment_terms_days,
        tax_label: form.tax_label,
        tax_number: form.tax_number,
      }));
      toast.show({ variant: 'success', description: 'Settings saved' });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveLock = async (value: string | null) => {
    try {
      await data.act((c) => c.setLockDate({ lock_date: value }));
      toast.show({ variant: 'success', description: value ? `Books locked through ${value}` : 'Books unlocked' });
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  return (
    <Page data-testid="settings">
      <PageHead><h1>Settings</h1></PageHead>

      <Panel>
        <h3>Organisation</h3>
        <FieldGrid>
          <Label>
            Organisation name
            <Input value={form.organisation_name} onChange={(e) => set('organisation_name', e.target.value)} data-testid="settings-name" />
          </Label>
          <Label>
            Base currency
            <Input value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} data-testid="settings-currency" />
          </Label>
          <Label>
            What tax is called
            <Select value={form.tax_label} onChange={(e) => set('tax_label', e.target.value)} data-testid="settings-tax-label">
              {['Tax', 'VAT', 'GST', 'Sales Tax'].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Label>
          <Label>
            {form.tax_label} registration number
            <Input value={form.tax_number} onChange={(e) => set('tax_number', e.target.value)} />
          </Label>
        </FieldGrid>
      </Panel>

      <Panel>
        <h3>Financial year and invoices</h3>
        <FieldGrid $cols={3}>
          <Label>
            Financial year ends
            <Select value={form.fy_end_month} onChange={(e) => set('fy_end_month', Number(e.target.value))} data-testid="settings-fy">
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Label>
          <Label>
            Invoice number prefix
            <Input value={form.invoice_prefix} maxLength={10} onChange={(e) => set('invoice_prefix', e.target.value)} data-testid="settings-prefix" />
          </Label>
          <Label>
            Default payment terms (days)
            <Input type="number" min={0} max={365} value={form.payment_terms_days}
              onChange={(e) => set('payment_terms_days', Math.max(0, Math.min(365, Number(e.target.value) || 0)))} data-testid="settings-terms" />
          </Label>
        </FieldGrid>
        <p className="help" style={{ marginTop: 10 }}>
          Changing the prefix renumbers every invoice&apos;s label; the order never changes. Numbers are given in the order
          invoices are approved.
        </p>
      </Panel>
      {error && <ErrorText>{error}</ErrorText>}
      <Row>
        <Button $variant="primary" onClick={save} disabled={busy} data-testid="settings-save">{busy ? 'Saving…' : 'Save settings'}</Button>
      </Row>

      <Panel>
        <h3>Lock date</h3>
        <p className="help">
          Once a period is filed or the year is closed, lock it: nothing dated on or before the lock date can be approved, paid,
          posted or voided until it is unlocked.
        </p>
        <Row $gap={8} $wrap>
          <Input type="date" value={lock} onChange={(e) => setLock(e.target.value)} style={{ maxWidth: 200 }} data-testid="settings-lock-date" />
          <Button onClick={() => saveLock(lock || null)} disabled={!lock || lock === s.lock_date} data-testid="settings-lock">Lock</Button>
          {s.lock_date && <Button $variant="danger" onClick={() => saveLock(null)}>Unlock</Button>}
          <span className="help" style={{ margin: 0 }}>{s.lock_date ? `Locked through ${s.lock_date}.` : 'Not locked.'}</span>
        </Row>
      </Panel>

      <Panel>
        <h3>Chart of accounts and tax rates</h3>
        <p className="help">
          Edit accounts under <Link to={`${APP_ROUTE}/accounting`}>Accounting → Chart of accounts</Link>, and rates under{' '}
          <Link to={`${APP_ROUTE}/accounting?tab=tax`}>Accounting → Tax rates</Link>.
        </p>
      </Panel>
    </Page>
  );
}
