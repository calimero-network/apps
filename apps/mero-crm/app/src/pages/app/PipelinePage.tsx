import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import AvatarGlyph from '../../components/AvatarGlyph';
import LostReasonModal from '../../components/LostReasonModal';
import { Chip, DueChip, Empty, HealthDot, Money } from '../../components/ui';
import { dealHealth, dealMatches, formatMoney } from '../../utils/crm';
import { describeError } from '../../utils/errors';
import type { DealView } from '../../hooks/useCrm';
import { useAppCtx } from './appContext';

const DRAG_TYPE = 'application/x-mero-deal';

/**
 * The board. One column per stage with its count, total and weighted value;
 * one card per open deal showing what matters at a glance — value, who, the
 * next step and whether it is late, and a health dot. Drag a card to another
 * column to move it, or onto Won / Lost at the bottom to close it.
 */
export default function PipelinePage(): React.ReactElement {
  const { data, ownerFilter, searchQuery, openNewDeal } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [losing, setLosing] = useState<DealView | null>(null);
  const now = Date.now();
  const { currency, rotting_days: rottingDays } = data.settings;

  const open = useMemo(
    () => data.deals
      .filter((d) => d.status === 'open')
      .filter((d) => !ownerFilter || d.owner === ownerFilter)
      .filter((d) => dealMatches(d, searchQuery)),
    [data.deals, ownerFilter, searchQuery],
  );

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { toast.show({ variant: 'error', description: describeError(err) }); }
  };

  const drop = (target: string) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const deal = data.deals.find((d) => d.id === id);
    if (!deal) return;
    if (target === '__won') {
      void run(async () => {
        await data.act((c) => c.markWon({ deal_id: id }));
        toast.show({ variant: 'success', description: `Won “${deal.title}” — ${formatMoney(deal.value, currency)}` });
      });
    } else if (target === '__lost') {
      setLosing(deal);
    } else if (target !== deal.stage_id) {
      void run(() => data.act((c) => c.moveDeal({ deal_id: id, stage_id: target })));
    }
  };

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overCol !== target) setOverCol(target);
    },
    onDragLeave: () => setOverCol((c) => (c === target ? null : c)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(target); },
  });

  if (!data.loaded) {
    return <Empty>{data.warmingUp ? 'Syncing this pipeline from your teammates…' : 'Loading pipeline…'}</Empty>;
  }

  const totalValue = open.reduce((a, d) => a + d.value, 0);
  const weighted = open.reduce((a, d) => a + Math.round((d.value * d.probability) / 100), 0);

  return (
    <Wrap>
      <Summary data-testid="pipeline-summary">
        <span><strong>{open.length}</strong> open deals</span>
        <span className="dot">·</span>
        <span><strong><Money value={totalValue} currency={currency} /></strong> in pipeline</span>
        <span className="dot">·</span>
        <span title="Each deal's value × its stage probability"><strong><Money value={weighted} currency={currency} /></strong> weighted</span>
        {searchQuery.trim() && <Chip>Filtered by “{searchQuery.trim()}”</Chip>}
      </Summary>
      <Board>
        {data.stages.map((stage) => {
          const cards = open.filter((d) => d.stage_id === stage.id);
          const value = cards.reduce((a, d) => a + d.value, 0);
          return (
            <Col
              key={stage.id}
              data-testid="stage-column"
              data-stage-id={stage.id}
              $over={overCol === stage.id}
              {...dropProps(stage.id)}
            >
              <ColHead>
                <div className="row">
                  <span className="name" data-testid="stage-name">{stage.name}</span>
                  <span className="count" data-testid={`count-${stage.id}`}>{cards.length}</span>
                  <button
                    className="add"
                    aria-label={`Add deal to ${stage.name}`}
                    data-testid={`add-deal-${stage.id}`}
                    onClick={() => openNewDeal({ stageId: stage.id })}
                  >+</button>
                </div>
                <div className="meta">
                  <Money value={value} currency={currency} compact /> · {stage.probability}%
                </div>
                <div className="bar"><span style={{ width: `${stage.probability}%` }} /></div>
              </ColHead>
              <div className="cards">
                {cards.map((deal) => {
                  const health = dealHealth(deal, rottingDays, now);
                  return (
                    <Card
                      key={deal.id}
                      data-testid="deal-card"
                      data-deal-id={deal.id}
                      draggable
                      $rotting={health.rotting}
                      $dragging={dragId === deal.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, deal.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(deal.id);
                      }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => navigate(`${APP_ROUTE}/deals/${deal.id}`)}
                    >
                      <div className="top">
                        <span className="title">{deal.title}</span>
                        <HealthDot health={health} />
                      </div>
                      {(deal.organization || deal.contact_name) && (
                        <div className="who">
                          {[deal.organization, deal.contact_name].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      <div className="bottom">
                        <span className="value"><Money value={deal.value} currency={currency} /></span>
                        {deal.next_activity ? (
                          <DueChip kind={deal.next_activity.kind} dueAt={deal.next_activity.due_at} subject={deal.next_activity.subject} now={now} />
                        ) : (
                          <Chip $color={t.color.high} title="No next step scheduled" data-testid="no-next-step">No next step</Chip>
                        )}
                        <span className="owner">
                          <AvatarGlyph seed={deal.owner} size="sm" title={deal.owner ?? 'Unassigned'} />
                        </span>
                      </div>
                      {health.rotting && <div className="rot">Idle {health.idleDays}d</div>}
                    </Card>
                  );
                })}
                {cards.length === 0 && (
                  <button className="empty" onClick={() => openNewDeal({ stageId: stage.id })}>
                    Drop a deal here or add one
                  </button>
                )}
              </div>
            </Col>
          );
        })}
      </Board>
      {dragId && (
        <CloseBar>
          <div className={`zone won${overCol === '__won' ? ' over' : ''}`} data-testid="drop-won" {...dropProps('__won')}>Won</div>
          <div className={`zone lost${overCol === '__lost' ? ' over' : ''}`} data-testid="drop-lost" {...dropProps('__lost')}>Lost</div>
        </CloseBar>
      )}
      {data.stages.length > 0 && open.length === 0 && !searchQuery.trim() && (
        <Hint>
          Your pipeline is empty. Press <kbd>N</kbd> or <strong>+ Deal</strong> to add the first one.
        </Hint>
      )}
      {losing && (
        <LostReasonModal
          dealTitle={losing.title}
          onConfirm={(reason) => data.act((c) => c.markLost({ deal_id: losing.id, reason }))}
          onClose={() => setLosing(null)}
        />
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative;`;
const Summary = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 16px 0; font-size: 12.5px; color: ${t.color.text2};
  strong { color: ${t.color.text}; font-weight: 600; }
  .dot { color: ${t.color.text3}; }
`;
const Board = styled.div`
  display: flex; gap: 12px; padding: 12px 16px 90px; overflow-x: auto; flex: 1; align-items: stretch; min-height: 0;
`;
const Col = styled.div<{ $over: boolean }>`
  flex: 1 0 216px; max-width: 320px; display: flex; flex-direction: column; min-height: 0;
  background: ${({ $over }) => ($over ? t.color.accentDim : 'rgba(255,255,255,0.015)')};
  border: 1px solid ${({ $over }) => ($over ? t.color.accentBorder : t.color.border)};
  border-radius: 10px; transition: background 120ms ease-out, border-color 120ms ease-out;
  .cards { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; flex: 1; }
  .empty {
    border: 1px dashed ${t.color.border}; border-radius: ${t.radius}; background: none; cursor: pointer;
    color: ${t.color.text3}; font-family: inherit; font-size: 12px; padding: 16px 8px;
    &:hover { color: ${t.color.text2}; border-color: ${t.color.borderStrong}; }
  }
`;
const ColHead = styled.div`
  padding: 10px 12px 8px; border-bottom: 1px solid ${t.color.border};
  .row { display: flex; align-items: center; gap: 8px; }
  .name { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: 11px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
  .add {
    margin-left: auto; width: 22px; height: 22px; border-radius: 5px; border: none; background: transparent;
    color: ${t.color.text3}; font-size: 16px; line-height: 1; cursor: pointer;
    &:hover { background: rgba(255,255,255,0.06); color: ${t.color.text}; }
  }
  .meta { font-size: 11.5px; color: ${t.color.text2}; margin-top: 3px; }
  .bar { height: 3px; border-radius: 2px; background: ${t.color.raised2}; margin-top: 8px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: ${t.color.accent}; opacity: 0.6; }
`;
const Card = styled.div<{ $rotting: boolean; $dragging: boolean }>`
  background: ${t.color.panel}; border: 1px solid ${({ $rotting }) => ($rotting ? 'rgba(229,105,95,0.35)' : t.color.border)};
  border-radius: 8px; padding: 10px 11px; cursor: grab; user-select: none;
  display: flex; flex-direction: column; gap: 6px;
  opacity: ${({ $dragging }) => ($dragging ? 0.4 : 1)};
  transition: background 120ms ease-out, border-color 120ms ease-out;
  &:hover { background: ${t.color.raised}; border-color: ${t.color.borderStrong}; }
  .top { display: flex; align-items: flex-start; gap: 8px; }
  .title { font-size: 12.5px; font-weight: 600; line-height: 1.35; flex: 1; min-width: 0; }
  .top > span:last-child { margin-top: 4px; }
  .who { font-size: 11.5px; color: ${t.color.text2}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bottom { display: flex; align-items: center; gap: 6px; }
  .value { font-size: 12px; font-weight: 600; color: ${t.color.text}; margin-right: auto; }
  .owner { display: inline-flex; }
  .rot { font-size: 10.5px; color: ${t.color.urgent}; font-weight: 600; }
`;
const CloseBar = styled.div`
  position: absolute; left: 16px; right: 16px; bottom: 16px; display: flex; gap: 12px; z-index: 6;
  .zone {
    flex: 1; text-align: center; padding: 18px; border-radius: 10px; font-weight: 700; font-size: 13px;
    border: 2px dashed; backdrop-filter: blur(6px); transition: background 120ms ease-out;
  }
  .won { color: ${t.color.done}; border-color: rgba(127,201,107,0.5); background: rgba(20,32,18,0.85); }
  .won.over { background: rgba(127,201,107,0.3); }
  .lost { color: ${t.color.urgent}; border-color: rgba(229,105,95,0.5); background: rgba(34,18,17,0.85); }
  .lost.over { background: rgba(229,105,95,0.3); }
`;
const Hint = styled.div`
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 999px;
  padding: 8px 16px; font-size: 12.5px; color: ${t.color.text2}; white-space: nowrap;
  kbd { font-family: ${t.font.mono}; font-size: 11px; border: 1px solid ${t.color.borderStrong}; border-radius: 4px; padding: 0 5px; }
`;
