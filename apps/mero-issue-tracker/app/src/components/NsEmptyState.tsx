import React from "react";
import styled from "styled-components";
import type { Namespace } from "@calimero-network/mero-react";
import { tokens as t } from "../theme";
import { PRODUCT_NAME } from "../config";
import { SelectMenu } from "./Dropdown";
import { IconPlus } from "./icons";
import ThemeToggle from "./ThemeToggle";
import { useSignOut } from "../auth/signOut";

interface Props {
  namespaces: Namespace[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** The workspace list failed: offer a retry, not a create that may duplicate. */
  failed?: boolean;
  onRetry?: () => void;
}

/** Full-pane onboarding shown whenever no namespace is active: the app mark,
 *  a one-line explainer, and the create action. Joining needs no button: an
 *  invitation link someone sent is opened, and the app offers it. When namespaces already
 *  exist (e.g. a prior explicit choice isn't valid anymore) it also offers a
 *  picker instead of assuming the visitor has none yet. */
export default function NsEmptyState({
  namespaces,
  onSelect,
  onCreate,
  failed = false,
  onRetry,
}: Props): React.ReactElement {
  const hasNamespaces = namespaces.length > 0;
  const signOut = useSignOut();
  return (
    <Wrap data-testid="ns-empty-state">
      {/* No sidebar here, so the theme switch and Log out sit in the corner. */}
      <Corner>
        <ThemeToggle />
        <button
          type="button"
          className="logout"
          data-testid="logout-btn"
          onClick={signOut}
        >
          Log out
        </button>
      </Corner>
      <Panel>
        <img
          className="mark"
          src="/favicon.svg"
          alt=""
          width={56}
          height={56}
        />
        <h1>Welcome to {PRODUCT_NAME}</h1>
        {failed && !hasNamespaces ? (
          <p data-testid="ns-list-failed">
            Your workspaces could not be loaded. Try again before creating one,
            so you do not end up with a second copy of a workspace you have.
          </p>
        ) : hasNamespaces ? (
          <>
            <p>
              Select a workspace to continue or create a new one. To join
              someone else's, open the invitation link they sent you.
            </p>
            <SelectMenu
              className="pick"
              testId="ns-empty-select"
              ariaLabel="Select a workspace"
              placeholder="Select a workspace"
              value=""
              options={namespaces.map((n) => ({
                value: n.namespaceId,
                label: n.name || n.namespaceId.slice(0, 8),
              }))}
              onChange={(v) => {
                if (v) onSelect(v);
              }}
            />
          </>
        ) : (
          <p>
            Create a team workspace to start tracking repositories and issues.
            To join someone else's, open the invitation link they sent you.
          </p>
        )}
        <div className="row">
          {failed && !hasNamespaces ? (
            <button
              className="primary"
              data-testid="ns-retry-btn"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : (
            <button
              className="primary"
              data-testid="ns-create-btn"
              onClick={onCreate}
            >
              <IconPlus size={13} /> Create workspace
            </button>
          )}
        </div>
      </Panel>
    </Wrap>
  );
}

const Wrap = styled.div`
  flex: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 72px 16px 24px; background: transparent; color: ${t.color.text}; font-family: ${t.font.sans};
`;
const Corner = styled.div`
  position: fixed; top: 16px; right: 16px; display: flex; align-items: center; gap: 6px;
  .logout {
    font-family: inherit; font-size: 13px; font-weight: 600; min-height: 38px; padding: 0 16px; cursor: pointer;
    border-radius: ${t.radiusPill}; color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
    &:hover { background: ${t.color.hover}; }
  }
`;
/* A frosted card on the page ground. It holds only an absolute dropdown, so
   its blur traps nothing; the dialogs it opens render outside it. */
const Panel = styled.div`
  width: 100%; max-width: 460px; text-align: center;
  padding: 40px 34px 34px; background: ${t.color.glass};
  border: 1px solid ${t.color.edge}; border-radius: 26px;
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur}; box-shadow: ${t.shadow};
  .mark { display: block; margin: 0 auto 20px; border-radius: 15px; box-shadow: 0 14px 30px -16px rgba(14, 18, 34, 0.6); }
  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 10px; }
  p { font-size: 14px; color: ${t.color.text2}; margin: 0 0 26px; line-height: 1.6; }
  .pick { display: flex; width: 100%; margin: -10px 0 22px; }
  .pick > button { width: 100%; min-height: 42px; padding: 0 14px; border-radius: 14px; font-size: 13.5px; font-weight: 600; box-shadow: ${t.shadowCard}; }
  .pick [role="listbox"] { text-align: left; font-weight: 500; width: 100%; }
  .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  button { font-family: inherit; }
  .row button {
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: ${t.radiusPill}; font-size: 13.5px; font-weight: 650; min-height: 42px; padding: 0 22px; cursor: pointer;
  }
  .primary {
    background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
    box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
    &:hover { background: ${t.color.accentHover}; }
  }
  @media (max-width: 520px) {
    padding: 30px 20px 24px; border-radius: 22px;
    .row button { flex: 1 1 100%; justify-content: center; }
  }
`;
