import type React from 'react';
import type { ListView } from '../generated/BoardClient';
import type { UseAliasesReturn } from '../hooks/useAliases';
import type { Workspace } from '../hooks/useBoards';

export interface CardModalProps {
  cardId: string;
  ws: Workspace;
  aliases: UseAliasesReturn;
  currentUser: string;
  members: string[];
  lists: ListView[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

/** Placeholder until Task 12 builds the card modal. */
export default function CardModal(_props: CardModalProps): React.ReactElement | null {
  return null;
}
