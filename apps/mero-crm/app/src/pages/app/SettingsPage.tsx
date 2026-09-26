import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { KindIcon } from '../../components/icons';
import { Button, Input, Label, Page, Panel, Row, Select } from '../../components/ui';
import { ACTIVITY_KINDS, ACTIVITY_LABEL } from '../../utils/crm';
import { describeError } from '../../utils/errors';
import type { StageView } from '../../hooks/useCrm';
import { useAppCtx } from './appContext';

/** Pipeline setup: stages, the automations that keep deals moving, and the
 *  two knobs (currency, rotting threshold). Shared by everyone on the pipeline. */
export default function SettingsPage(): React.ReactElement {
  const { data } = useAppCtx();
  const toast = useToast();
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.show({ variant: 'success', description: ok });
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = data.stages.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void run(() => data.act((c) => c.reorderStages({ stage_ids: ids })));
  };

  return (
    <Page>
      <Panel data-testid="stages-settings">
        <h3>Stages</h3>
        <p className="help">The columns of your pipeline, in order. Probability drives the weighted forecast.</p>
        <StageList>
          {data.stages.map((s, i) => (
            <StageRow
              key={s.id}
              stage={s}
              first={i === 0}
              last={i === data.stages.length - 1}
              openDeals={data.deals.filter((d) => d.status === 'open' && d.stage_id === s.id).length}
              onSave={(name, probability) => run(() => data.act((c) => c.updateStage({ stage_id: s.id, name, probability })), 'Stage saved')}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onDelete={() => {
                if (!window.confirm(`Delete the ${s.name} stage and its automations?`)) return;
                void run(() => data.act((c) => c.deleteStage({ stage_id: s.id })));
              }}
            />
          ))}
        </StageList>
        <AddStage onAdd={(name, probability) => run(() => data.act((c) => c.addStage({ name, probability })), `Added ${name}`)} />
      </Panel>

      <Panel data-testid="automations-settings">
        <h3>Automations</h3>
        <p className="help">
          Never let a deal arrive somewhere without a next step. When a deal enters a stage, these
          schedule an activity for the deal's owner automatically.
        </p>
        <AutoList>
          {data.automations.length === 0 && <li className="none">No automations yet — add your first below.</li>}
          {data.automations.map((a) => (
            <li key={a.id} data-testid="automation-row" className={a.enabled ? '' : 'off'}>
              <input
                type="checkbox"
                checked={a.enabled}
                aria-label={a.enabled ? 'Disable automation' : 'Enable automation'}
                onChange={() => run(() => data.act((c) => c.setAutomationEnabled({ automation_id: a.id, enabled: !a.enabled })))}
              />
              <span>
                When a deal enters <strong>{data.stages.find((s) => s.id === a.stage_id)?.name ?? '—'}</strong>, schedule{' '}
                <KindIcon kind={a.kind} /> <strong>{a.subject}</strong>{' '}
                {a.due_in_days === 0 ? 'for the same day' : `due in ${a.due_in_days} day${a.due_in_days === 1 ? '' : 's'}`}
              </span>
              <button className="x" aria-label="Delete automation" onClick={() => run(() => data.act((c) => c.deleteAutomation({ automation_id: a.id })))}>×</button>
            </li>
          ))}
        </AutoList>
        <AddAutomation
          stages={data.stages}
          onAdd={(stageId, kind, subject, days) => run(() => data.act((c) => c.addAutomation({ stage_id: stageId, kind, subject, due_in_days: days })), 'Automation added')}
        />
      </Panel>

      <Panel>
        <h3>Pipeline</h3>
        <General
          currency={data.settings.currency}
          rottingDays={data.settings.rotting_days}
          onCurrency={(currency) => run(() => data.act((c) => c.setCurrency({ currency })), `Currency set to ${currency}`)}
          onRotting={(days) => run(() => data.act((c) => c.setRottingDays({ days })), 'Saved')}
        />
      </Panel>
    </Page>
  );
}

function StageRow({
  stage, first, last, openDeals, onSave, onUp, onDown, onDelete,
}: {
  stage: StageView; first: boolean; last: boolean; openDeals: number;
  onSave: (name: string, probability: number) => void; onUp: () => void; onDown: () => void; onDelete: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [prob, setProb] = useState(String(stage.probability));
  useEffect(() => { setName(stage.name); setProb(String(stage.probability)); }, [stage.name, stage.probability]);
  const p = Number(prob);
  const dirty = name.trim() !== stage.name || p !== stage.probability;
  const valid = !!name.trim() && Number.isInteger(p) && p >= 0 && p <= 100;
  return (
    <li data-testid="stage-row">
      <div className="order">
        <button onClick={onUp} disabled={first} aria-label={`Move ${stage.name} up`}>↑</button>
        <button onClick={onDown} disabled={last} aria-label={`Move ${stage.name} down`}>↓</button>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Stage name" style={{ flex: 1, maxWidth: 420 }} />
      <Input value={prob} onChange={(e) => setProb(e.target.value)} aria-label="Win probability" style={{ width: 70 }} inputMode="numeric" />
      <span className="pct">%</span>
      <Button
        $small
        $variant="primary"
        disabled={!valid}
        onClick={() => onSave(name.trim(), p)}
        style={{ visibility: dirty ? 'visible' : 'hidden' }}
      >Save</Button>
      <Button
        $small
        $variant="danger"
        onClick={onDelete}
        disabled={openDeals > 0}
        title={openDeals > 0 ? `Move its ${openDeals} open deal${openDeals === 1 ? '' : 's'} first` : 'Delete stage'}
      >Delete</Button>
    </li>
  );
}

function AddStage({ onAdd }: { onAdd: (name: string, probability: number) => void }) {
  const [name, setName] = useState('');
  const [prob, setProb] = useState('50');
  const p = Number(prob);
  const valid = !!name.trim() && Number.isInteger(p) && p >= 0 && p <= 100;
  return (
    <Row $gap={8} style={{ marginTop: 10 }}>
      <Input placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} data-testid="new-stage-name" />
      <Input value={prob} onChange={(e) => setProb(e.target.value)} style={{ width: 70 }} aria-label="Win probability" inputMode="numeric" />
      <span style={{ color: t.color.text3 }}>%</span>
      <Button disabled={!valid} onClick={() => { onAdd(name.trim(), p); setName(''); }} data-testid="new-stage-add">Add stage</Button>
    </Row>
  );
}

function AddAutomation({ stages, onAdd }: { stages: StageView[]; onAdd: (stageId: string, kind: string, subject: string, days: number) => void }) {
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [kind, setKind] = useState('call');
  const [subject, setSubject] = useState('');
  const [days, setDays] = useState('1');
  useEffect(() => { if (!stages.some((s) => s.id === stageId)) setStageId(stages[0]?.id ?? ''); }, [stages, stageId]);
  const d = Number(days);
  const valid = !!stageId && !!subject.trim() && Number.isInteger(d) && d >= 0 && d <= 365;
  return (
    <Row $wrap $gap={8} style={{ marginTop: 10 }}>
      <span className="lbl" style={{ fontSize: 12.5, color: t.color.text2 }}>When a deal enters</span>
      <Select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ width: 150 }} aria-label="Stage" data-testid="auto-stage">
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <span style={{ fontSize: 12.5, color: t.color.text2 }}>schedule</span>
      <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 110 }} aria-label="Activity type">
        {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
      </Select>
      <Input placeholder="e.g. Send the proposal" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ flex: '1 1 180px', width: 'auto' }} aria-label="Activity subject" data-testid="auto-subject" />
      <span style={{ fontSize: 12.5, color: t.color.text2 }}>due in</span>
      <Input value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 60 }} inputMode="numeric" aria-label="Days" />
      <span style={{ fontSize: 12.5, color: t.color.text2 }}>days</span>
      <Button $variant="primary" disabled={!valid} onClick={() => { onAdd(stageId, kind, subject.trim(), d); setSubject(''); }} data-testid="auto-add">Add</Button>
    </Row>
  );
}

function General({ currency, rottingDays, onCurrency, onRotting }: {
  currency: string; rottingDays: number; onCurrency: (c: string) => void; onRotting: (d: number) => void;
}) {
  const [cur, setCur] = useState(currency);
  const [rot, setRot] = useState(String(rottingDays));
  useEffect(() => setCur(currency), [currency]);
  useEffect(() => setRot(String(rottingDays)), [rottingDays]);
  const code = cur.trim().toUpperCase();
  const r = Number(rot);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
      <Label>
        Currency
        <Row $gap={8}>
          <Input value={cur} maxLength={3} onChange={(e) => setCur(e.target.value)} style={{ width: 90 }} data-testid="currency-input" />
          <Button disabled={code === currency || !/^[A-Z]{3}$/.test(code)} onClick={() => onCurrency(code)}>Save</Button>
        </Row>
      </Label>
      <Label>
        Flag a deal as rotting after (days without activity)
        <Row $gap={8}>
          <Input value={rot} onChange={(e) => setRot(e.target.value)} style={{ width: 90 }} inputMode="numeric" />
          <Button disabled={r === rottingDays || !Number.isInteger(r) || r < 1 || r > 365} onClick={() => onRotting(r)}>Save</Button>
        </Row>
      </Label>
    </div>
  );
}

const StageList = styled.ul`
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px;
  li { display: flex; align-items: center; gap: 8px; }
  .order { display: flex; flex-direction: column; }
  .order button {
    background: none; border: none; color: ${t.color.text3}; cursor: pointer; font-size: 10px; line-height: 1; padding: 1px 4px;
    &:hover:not(:disabled) { color: ${t.color.text}; }
    &:disabled { opacity: 0.3; cursor: default; }
  }
  .pct { color: ${t.color.text3}; }
`;
const AutoList = styled.ul`
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
  li {
    display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid ${t.color.border};
    font-size: 12.5px; color: ${t.color.text2};
    strong { color: ${t.color.text}; font-weight: 600; }
    svg { vertical-align: -2px; }
  }
  li:first-child { border-top: none; }
  li.off span { opacity: 0.5; }
  li.none { color: ${t.color.text3}; }
  span { flex: 1; }
  input[type='checkbox'] { accent-color: ${t.color.accent}; width: 15px; height: 15px; cursor: pointer; }
  .x { background: none; border: none; color: ${t.color.text3}; cursor: pointer; font-size: 16px; &:hover { color: ${t.color.danger}; } }
`;
