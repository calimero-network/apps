/**
 * AttachmentsPanel — files attached to the selected cell. Each file is a
 * blob announced to this workbook, so collaborators' nodes can fetch it;
 * the cell keeps its name, size and who attached it.
 */
import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import type { Attachment } from '../hooks/useSpreadsheet';
import { ago, nsToMs } from '../lib/time';

const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function AttachmentsPanel({
  label, files, canEdit, selfId, isOwner, nameOf, onUpload, onRemove, onFetch, onClose,
}: {
  label: string;
  files: Attachment[];
  canEdit: boolean;
  selfId: string | null;
  isOwner: boolean;
  nameOf: (memberId: string) => string;
  onUpload: (file: File) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onFetch: (blobId: string) => Promise<ArrayBuffer>;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Object URLs are released with the panel.
  useEffect(() => () => { Object.values(previews).forEach((u) => URL.revokeObjectURL(u)); }, [previews]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  };
  const urlOf = async (f: Attachment) => {
    const known = previews[f.id];
    if (known) return known;
    const url = URL.createObjectURL(new Blob([await onFetch(f.blob_id)], { type: f.mime || 'application/octet-stream' }));
    setPreviews((p) => ({ ...p, [f.id]: url }));
    return url;
  };
  const download = (f: Attachment) => run(f.id, async () => {
    const a = document.createElement('a');
    a.href = await urlOf(f);
    a.download = f.name;
    a.click();
  });

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label={`Files on ${label}`} onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Files · {label}</span>
          <CloseBtn onClick={onClose} aria-label="Close files">×</CloseBtn>
        </Header>
        {canEdit && (
          <Bar>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              data-testid="field-attach"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = '';
                void run('upload', async () => { for (const f of picked) await onUpload(f); });
              }}
            />
            <button type="button" disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy === 'upload' ? 'Uploading…' : 'Attach files'}
            </button>
            <span>Up to 50 MB each. Everyone in the workbook can open them.</span>
          </Bar>
        )}
        {error && <Err role="alert">{error}</Err>}
        <List>
          {files.length === 0 && <Empty>No files on {label}.</Empty>}
          {files.map((f) => (
            <Item key={f.id} data-testid="item-Attachment">
              {f.mime.startsWith('image/') && previews[f.id] && <img src={previews[f.id]} alt={f.name} />}
              <div className="name">{f.name}</div>
              <div className="meta">{sizeLabel(f.size)} · {nameOf(f.created_by)} · {ago(nsToMs(f.created_at))}</div>
              <div className="actions">
                <button type="button" disabled={busy !== null} onClick={() => void download(f)} data-testid="action-download-file">
                  {busy === f.id ? 'Fetching…' : 'Download'}
                </button>
                {f.mime.startsWith('image/') && !previews[f.id] && (
                  <button type="button" disabled={busy !== null} onClick={() => void run(f.id, async () => { await urlOf(f); })}>Preview</button>
                )}
                {canEdit && (f.created_by === selfId || isOwner) && (
                  <button type="button" disabled={busy !== null} onClick={() => void run(f.id, () => onRemove(f.id))}>Remove</button>
                )}
              </div>
            </Item>
          ))}
        </List>
      </Panel>
    </Overlay>
  );
}

const slideIn = keyframes`from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 200; background: rgba(14, 20, 15, 0.3); backdrop-filter: blur(2px);
  animation: ${fadeIn} 0.18s ease; display: flex; justify-content: flex-end;
`;
const Panel = styled.div`
  width: 420px; max-width: 100vw; height: 100%; background: ${C.paper}; border-left: 1px solid ${C.line};
  display: flex; flex-direction: column; animation: ${slideIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid ${C.line};
  .title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; font-size: 20px; color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const Bar = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid ${C.line};
  button { padding: 7px 14px; font-size: 13px; font-weight: 600; border-radius: 8px; cursor: pointer; color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c; }
  button:disabled { opacity: 0.5; }
  span { font-size: 11.5px; color: ${C.mutedSoft}; }
`;
const Err = styled.p`margin: 0; padding: 8px 18px; font-size: 12.5px; color: ${C.danger};`;
const List = styled.ul`list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1;`;
const Empty = styled.li`padding: 28px 18px; text-align: center; font-size: 13px; color: ${C.muted};`;
const Item = styled.li`
  padding: 12px 18px; border-bottom: 1px solid ${C.line};
  img { display: block; max-width: 100%; max-height: 180px; border-radius: 8px; margin-bottom: 8px; }
  .name { font-size: 13.5px; color: ${C.ink}; word-break: break-all; }
  .meta { font-size: 11.5px; color: ${C.mutedSoft}; margin-top: 2px; }
  .actions { display: flex; gap: 12px; margin-top: 6px; }
  .actions button { font-size: 12px; color: ${C.greenDeep}; background: none; border: none; cursor: pointer; padding: 0; }
  .actions button:disabled { opacity: 0.5; }
`;
