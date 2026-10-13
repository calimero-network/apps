import React from 'react';
import styled from 'styled-components';
import { useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { APP_ROUTE } from '../config';

/** Sticky top bar: contextual view title and the active folder's name. */
export default function Topbar({
  folderName,
}: {
  folderName: string | null;
}): React.ReactElement {
  const loc = useLocation();

  let title: React.ReactNode = 'Boards';
  if (loc.pathname === `${APP_ROUTE}/members`) {
    title = 'Members';
  }

  return (
    <Bar>
      <ViewTitle>{title}</ViewTitle>
      {folderName && (
        <FolderName>
          <span className="folder-name" data-testid="folder-header-name">{folderName}</span>
        </FolderName>
      )}
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 0 16px; height: 48px;
  border-bottom: 1px solid ${t.color.border};
  position: sticky; top: 0; background: ${t.color.bg}; z-index: 5;
`;
const ViewTitle = styled.div`
  font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em;
  display: flex; align-items: center; gap: 8px;
`;
const FolderName = styled.div`
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding-left: 12px; margin-left: 2px; border-left: 1px solid ${t.color.border};
  .folder-name { font-size: 12.5px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap; }
`;
