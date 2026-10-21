import React from "react";
import styled from "styled-components";
import type { Namespace } from "@calimero-network/mero-react";
import { tokens as t } from "../theme";
import { APP_DISPLAY_NAME } from "../config";
import { SelectMenu } from "./Dropdown";
import { LogoMark } from "./icons";
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
        <span className="mark">
          <LogoMark />
        </span>
        <h1>Welcome to {APP_DISPLAY_NAME}</h1>
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
            Create a team workspace to start tracking deals. To join someone
            else's, open the invitation link they sent you.
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
              Create workspace
            </button>
          )}
        </div>
      </Panel>
    </Wrap>
  );
}

const Wrap = styled.div`
  flex: 1;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: transparent;
  color: ${t.color.text};
  font-family: ${t.font.sans};
`;
const Corner = styled.div`
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  .logout {
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 16px;
    cursor: pointer;
    border-radius: ${t.radiusPill};
    color: ${t.color.text};
    background: ${t.color.raised};
    border: 1px solid ${t.color.border};
    &:hover {
      background: ${t.color.raised2};
    }
  }
`;
const Panel = styled.div`
  max-width: 460px;
  width: 100%;
  text-align: center;
  padding: 44px 36px;
  background: ${t.color.glass};
  -webkit-backdrop-filter: ${t.blur};
  backdrop-filter: ${t.blur};
  border: 1px solid ${t.color.edge};
  border-radius: 26px;
  box-shadow: ${t.shadow};
  @media (max-width: 720px) {
    padding: 32px 22px;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 46px;
    height: 46px;
    margin-bottom: 18px;
    border-radius: 12px;
    background: ${t.color.accentDim};
    border: 1px solid ${t.color.accentBorder};
    color: ${t.color.accentText};
  }
  h1 {
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -0.035em;
    margin: 0 0 10px;
  }
  p {
    font-size: 13.5px;
    color: ${t.color.text2};
    margin: 0 0 26px;
    line-height: 1.6;
  }
  .pick {
    display: flex;
    width: 100%;
    margin: -12px 0 26px;
  }
  .pick > button {
    width: 100%;
    padding: 10px 12px;
    border-radius: ${t.radius};
    font-size: 13px;
    font-weight: 600;
  }
  .pick [role="listbox"] {
    text-align: left;
    font-weight: 500;
  }
  .row {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .row button {
    font-family: inherit;
    border-radius: ${t.radiusPill};
    font-size: 13.5px;
    font-weight: 600;
    min-height: 42px;
    padding: 0 20px;
    cursor: pointer;
  }
  .primary {
    background: ${t.color.accent};
    color: ${t.color.onAccent};
    border: 1px solid transparent;
    &:hover {
      background: ${t.color.accentHover};
    }
  }
`;
