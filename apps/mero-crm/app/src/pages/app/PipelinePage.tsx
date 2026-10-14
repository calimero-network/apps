import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import AvatarGlyph from '../../components/AvatarGlyph';
import LostReasonModal from '../../components/LostReasonModal';
import { Chip, DueChip, Empty, HealthDot, Money } from '../../components/ui';
import { IconPlus } from '../../components/icons';
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
        <span className="stat"><strong>{open.length}</strong> open deals</span>
        <span className="stat"><strong><Money value={totalValue} currency={currency} /></strong> in pipeline</span>
        <span className="stat" title="Each deal's value × its stage probability"><strong><Money value={weighted} currency={currency} /></strong> weighted</span>
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
                  ><IconPlus size={12} /></button>
                </div>
                <div className="meta">
                  <span className="total"><Money value={value} currency={currency} compact /></span>
                  <span className="prob" title="Win probability at this stage">{stage.probability}%</span>
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
                        <span className="owner">
                          <AvatarGlyph seed={deal.owner} size="sm" title={deal.owner ?? 'Unassigned'} />
                        </span>
                      </div>
                      <div className="next">
                        {deal.next_activity ? (
                          <DueChip kind={deal.next_activity.kind} dueAt={deal.next_activity.due_at} subject={deal.next_activity.subject} now={now} />
                        ) : (
                          <Chip $color={t.color.high} title="No next step scheduled" data-testid="no-next-step">No next step</Chip>
                        )}
                        {health.rotting && <span className="rot">Idle {health.idleDays}d</span>}
                      </div>
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
  padding: 16px 16px 0; font-size: 12.5px; color: ${t.color.text2};
  .stat {
    display: inline-flex; align-items: baseline; gap: 5px; padding: 6px 12px; border-radius: ${t.radiusPill};
    background: ${t.color.glass}; border: 1px solid ${t.color.edge}; box-shadow: ${t.shadow};
  }
  strong { color: ${t.color.text}; font-weight: 700; font-size: 13.5px; letter-spacing: -0.01em; }
  @media (max-width: 720px) {
    padding: 12px 12px 2px; gap: 6px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
    .stat { padding: 5px 10px; white-space: nowrap; flex: 0 0 auto; }
  }
`;
const Board = styled.div`
  display: flex; gap: 10px; padding: 14px 16px 96px; overflow-x: auto; flex: 1; align-items: stretch; min-height: 0;
  @media (max-width: 720px) {
    padding: 12px 12px 96px; scroll-snap-type: x mandatory; scroll-padding: 12px;
  }
`;
/* A lane: lighter frost than a panel, so the solid cards on it are what reads.
   Its blur traps nothing — the lost-reason dialog renders outside the board. */
const Col = styled.div<{ $over: boolean }>`
  flex: 1 0 178px; max-width: 320px; display: flex; flex-direction: column; min-height: 0;
  background: ${({ $over }) => ($over ? t.color.accentDim : t.color.lane)};
  border: 1px solid ${({ $over }) => ($over ? t.color.accentBorder : t.color.edge)};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur};
  border-radius: ${t.radiusLg}; transition: background 120ms ease-out, border-color 120ms ease-out;
  .cards { display: flex; flex-direction: column; gap: 10px; padding: 4px 10px 12px; overflow-y: auto; flex: 1; }
  .empty {
    border: 1.5px dashed ${t.color.borderStrong}; border-radius: 14px; background: none; cursor: pointer;
    color: ${t.color.text3}; font-family: inherit; font-size: 12.5px; padding: 18px 10px; line-height: 1.4;
    &:hover { color: ${t.color.text2}; border-color: ${t.color.text3}; background: ${t.color.hover}; }
  }
  @media (max-width: 720px) { flex: 0 0 82vw; max-width: none; scroll-snap-align: start; }
`;
const ColHead = styled.div`
  padding: 14px 14px 12px;
  .row { display: flex; align-items: center; gap: 8px; }
  .name { font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 650; color: ${t.color.text2}; background: ${t.color.raised2}; font-variant-numeric: tabular-nums;
  }
  .add {
    margin-left: auto; width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center;
    border: 1px solid ${t.color.border}; background: ${t.color.raised};
    color: ${t.color.text2}; cursor: pointer;
    &:hover { color: ${t.color.onAccent}; background: ${t.color.accent}; border-color: transparent; }
  }
  .meta { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
  .total { font-size: 17px; font-weight: 700; letter-spacing: -0.02em; color: ${t.color.text}; }
  .prob { font-size: 11.5px; font-weight: 600; color: ${t.color.text3}; margin-left: auto; font-variant-numeric: tabular-nums; }
  .bar { height: 4px; border-radius: 999px; background: ${t.color.raised2}; margin-top: 8px; overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 999px; background: var(--glass-grad); }
`;
const Card = styled.div<{ $rotting: boolean; $dragging: boolean }>`
  background: ${t.color.panel};
  border: 1px solid ${({ $rotting }) => ($rotting ? t.color.dangerBorder : 'transparent')};
  border-radius: 14px; padding: 12px 13px; cursor: grab; user-select: none;
  /* Content: solid and sharp on the frosted lane. */
  box-shadow: ${t.shadowCard};
  display: flex; flex-direction: column; gap: 7px;
  opacity: ${({ $dragging }) => ($dragging ? 0.4 : 1)};
  transition: box-shadow 150ms ease-out, transform 150ms ease-out;
  &:hover { box-shadow: ${t.shadowLift}; transform: translateY(-1px); }
  .top { display: flex; align-items: flex-start; gap: 8px; }
  .title { font-size: 13.5px; font-weight: 650; line-height: 1.35; letter-spacing: -0.01em; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .top > span:last-child { margin-top: 5px; }
  .who { font-size: 12px; color: ${t.color.text2}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: -3px; }
  .bottom { display: flex; align-items: center; gap: 6px; }
  .value { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; color: ${t.color.text}; margin-right: auto; }
  .owner { display: inline-flex; }
  .next { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rot { font-size: 11px; color: ${t.color.urgent}; font-weight: 650; }
  @media (prefers-reduced-motion: reduce) { &:hover { transform: none; } }
`;
const CloseBar = styled.div`
  position: absolute; left: 20px; right: 20px; bottom: 18px; display: flex; gap: 12px; z-index: 6;
  .zone {
    flex: 1; text-align: center; padding: 20px; border-radius: ${t.radiusLg}; font-weight: 700; font-size: 14px;
    border: 2px dashed; transition: background 120ms ease-out; box-shadow: ${t.shadowFloat};
  }
  .won { color: ${t.color.done}; border-color: color-mix(in srgb, ${t.color.done} 55%, transparent); background: ${t.color.goodBg}; }
  .won.over { background: color-mix(in srgb, ${t.color.done} 30%, ${t.color.panel}); }
  .lost { color: ${t.color.urgent}; border-color: color-mix(in srgb, ${t.color.urgent} 55%, transparent); background: ${t.color.badBg}; }
  .lost.over { background: color-mix(in srgb, ${t.color.urgent} 30%, ${t.color.panel}); }
`;
const Hint = styled.div`
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
  width: max-content; max-width: calc(100% - 32px); text-align: center;
  background: ${t.color.panel}; border-radius: 999px; box-shadow: ${t.shadowFloat};
  padding: 10px 18px; font-size: 13px; color: ${t.color.text2};
  strong { color: ${t.color.text}; }
  kbd { font-family: ${t.font.mono}; font-size: 11px; border: 1px solid ${t.color.borderStrong}; border-radius: 5px; padding: 0 5px; }
  @media (max-width: 720px) { border-radius: 18px; }
`;
