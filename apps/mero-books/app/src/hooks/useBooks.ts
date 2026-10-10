/**
 * useBooks — the data binding for one organisation (one context).
 *
 * A small business's books are small enough to hold whole: settings, the
 * chart, tax rates, contacts, every invoice and bill, payments, bank
 * transactions and journals are read together in one round, and the lists
 * derive from that snapshot. Reports and the dashboard are computed by the
 * contract and fetched on demand with `query`, keyed on `version` so they
 * re-read whenever anything changed.
 *
 *  - `useSubscription([contextId])` re-reads on every sync event, so a
 *    teammate's payment appears with no polling (debounced: a join replicates
 *    in a burst).
 *  - Reads never overlap; a change during a read costs exactly one more read.
 *  - A context whose state has not replicated yet reports `warmingUp`, not an
 *    error (see utils/contextReadiness).
 *  - `act(fn)` runs any mutation through the typed client and then re-reads.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import {
  BooksClient,
  type AccountView,
  type BankTransactionView,
  type ContactView,
  type InvoiceView,
  type JournalView,
  type PaymentView,
  type Settings,
  type TaxRateView,
} from '../generated/BooksClient';
import { SYNC_COALESCE_MS, WARMUP_RETRY_MS, classifyReadError } from '../utils/contextReadiness';

export interface UseBooksArgs {
  contextId: string | null;
  executorPublicKey: string | null;
}

export interface UseBooksReturn {
  settings: Settings;
  /** Every account, archived included (pickers filter them out). */
  accounts: AccountView[];
  taxRates: TaxRateView[];
  contacts: ContactView[];
  invoices: InvoiceView[];
  payments: PaymentView[];
  bankTransactions: BankTransactionView[];
  journals: JournalView[];
  loading: boolean;
  loaded: boolean;
  error: Error | null;
  warmingUp: boolean;
  ready: boolean;
  /** Bumped after every successful read — what on-demand queries key on. */
  version: number;
  refresh: () => Promise<void>;
  /** Run a mutation, then re-read. Throws on failure. */
  act: <T>(fn: (client: BooksClient) => Promise<T>) => Promise<T>;
  /** Run a read against the contract (reports, details). */
  query: <T>(fn: (client: BooksClient) => Promise<T>) => Promise<T>;
}

export const DEFAULT_SETTINGS: Settings = {
  organisation_name: '',
  currency: 'USD',
  fy_end_month: 12,
  invoice_prefix: 'INV-',
  payment_terms_days: 30,
  tax_label: 'Tax',
  tax_number: '',
  lock_date: null,
};

export function useBooks({ contextId, executorPublicKey }: UseBooksArgs): UseBooksReturn {
  const { mero } = useMero();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateView[]>([]);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransactionView[]>([]);
  const [journals, setJournals] = useState<JournalView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [warmingUp, setWarmingUp] = useState(false);
  const [version, setVersion] = useState(0);

  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const warmingSinceRef = useRef<number | null>(null);

  const client = useMemo(
    () => (mero && contextId && executorPublicKey ? new BooksClient(mero, contextId) : null),
    [mero, contextId, executorPublicKey],
  );

  // Switching organisation must not show the previous one's books for a beat.
  useEffect(() => {
    setSettings(DEFAULT_SETTINGS); setAccounts([]); setTaxRates([]); setContacts([]);
    setInvoices([]); setPayments([]); setBankTransactions([]); setJournals([]);
    setLoaded(false);
  }, [contextId]);

  const refresh = useCallback(async () => {
    if (!client) return;
    if (inFlightRef.current) { pendingRef.current = true; return; }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [se, ac, tr, co, inv, pa, bt, jn] = await Promise.all([
        client.getSettings(),
        client.listAccounts({ include_archived: true }),
        client.listTaxRates(),
        client.listContacts(),
        client.listInvoices({ kind: null }),
        client.listPayments({ bank_account_id: null }),
        client.listBankTransactions({ bank_account_id: null }),
        client.listJournals(),
      ]);
      setSettings(se ?? DEFAULT_SETTINGS);
      setAccounts(ac ?? []);
      setTaxRates(tr ?? []);
      setContacts(co ?? []);
      setInvoices(inv ?? []);
      setPayments(pa ?? []);
      setBankTransactions(bt ?? []);
      setJournals(jn ?? []);
      setLoaded(true);
      setVersion((v) => v + 1);
      setError(null);
      setWarmingUp(false);
      warmingSinceRef.current = null;
    } catch (err) {
      const outcome = classifyReadError(err, warmingSinceRef.current);
      warmingSinceRef.current = outcome.warmingSince;
      setWarmingUp(outcome.warmingUp);
      setError(outcome.error);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void refreshRef.current();
      }
    }
  }, [client]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!warmingUp || !client) return;
    const timer = setInterval(() => void refreshRef.current(), WARMUP_RETRY_MS);
    return () => clearInterval(timer);
  }, [warmingUp, client]);

  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (coalesceRef.current) clearTimeout(coalesceRef.current); }, []);
  useSubscription(contextId ? [contextId] : [], () => {
    if (coalesceRef.current) clearTimeout(coalesceRef.current);
    coalesceRef.current = setTimeout(() => {
      coalesceRef.current = null;
      void refreshRef.current();
    }, SYNC_COALESCE_MS);
  });
  useStreamReconnect(() => { void refreshRef.current(); });

  const act = useCallback(
    async <T,>(fn: (c: BooksClient) => Promise<T>): Promise<T> => {
      if (!client) throw new Error('Books not ready yet');
      const result = await fn(client);
      await refresh();
      return result;
    },
    [client, refresh],
  );

  const query = useCallback(
    async <T,>(fn: (c: BooksClient) => Promise<T>): Promise<T> => {
      if (!client) throw new Error('Books not ready yet');
      return fn(client);
    },
    [client],
  );

  return {
    settings, accounts, taxRates, contacts, invoices, payments, bankTransactions, journals,
    loading, loaded, error, warmingUp, ready: client !== null, version,
    refresh, act, query,
  };
}

/**
 * Re-run a contract read whenever the books change. Returns the latest value
 * (kept while a re-read is in flight, so a report does not flash empty).
 */
export function useQuery<T>(
  books: Pick<UseBooksReturn, 'query' | 'version' | 'ready'>,
  fn: (c: BooksClient) => Promise<T>,
  deps: unknown[],
): { data: T | null; error: Error | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!books.ready) return;
    let live = true;
    setLoading(true);
    books
      .query((c) => fnRef.current(c))
      .then((v) => { if (live) { setData(v); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books.ready, books.version, ...deps]);
  return { data, error, loading };
}
