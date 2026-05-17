import { useState, useCallback } from "react";
import { styled } from "styled-components";
import { Button, Input } from "@calimero-network/mero-ui";
import axios from "axios";
import { getNodeUrl as getAppEndpointKey } from "@calimero-network/mero-react";
import { getAuthConfig } from "../../api/meroJsClient";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import {
  getApplicationId,
  setGroupId,
  setGroupMemberIdentity,
} from "../../constants/config";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const PopupContainer = styled.div`
  background: #1a1a1f;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 480px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
`;

const Title = styled.h2`
  color: #ffffff;
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  text-align: center;
`;

const Subtitle = styled.p`
  color: #b8b8d1;
  font-size: 0.85rem;
  text-align: center;
  margin-bottom: 1.5rem;
`;

const StepIndicator = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
`;

const StepDot = styled.div<{ $active: boolean; $done: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $active, $done }) =>
    $done ? "#27ae60" : $active ? "#7c3aed" : "rgba(255, 255, 255, 0.15)"};
  transition: background 0.2s;
`;

const Message = styled.div<{ $type?: "success" | "error" | "info" }>`
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  margin-bottom: 1rem;
  color: ${({ $type }) =>
    $type === "success"
      ? "#27ae60"
      : $type === "error"
        ? "#e74c3c"
        : "#b8b8d1"};
  background: ${({ $type }) =>
    $type === "success"
      ? "rgba(39, 174, 96, 0.1)"
      : $type === "error"
        ? "rgba(231, 76, 60, 0.1)"
        : "rgba(184, 184, 209, 0.1)"};
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const Label = styled.label`
  font-size: 0.75rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
`;

type Step = "form" | "creating" | "error";

interface CreateWorkspacePopupProps {
  onSuccess: (groupId: string) => void;
  onCancel: () => void;
}

const DEFAULT_NODE_ENDPOINT = "http://localhost:2428";

function getAuthHeaders(): Record<string, string> {
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authConfig?.jwtToken) {
    headers.Authorization = `Bearer ${authConfig.jwtToken}`;
  }
  return headers;
}

async function resolveApplicationId(preferredId: string): Promise<string> {
  const nodeEndpoint = getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
  const response = await axios.get(`${nodeEndpoint}/admin-api/applications`, {
    headers: getAuthHeaders(),
  });

  const apps = response.data?.data?.apps;
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error("No installed applications found on this node.");
  }

  const appIds = apps
    .map((app: unknown) => {
      if (!app || typeof app !== "object") return "";
      const typedApp = app as { id?: string; applicationId?: string };
      return typedApp.id || typedApp.applicationId || "";
    })
    .filter((id: string) => id.length > 0);

  if (appIds.includes(preferredId)) {
    return preferredId;
  }

  return appIds[0];
}

export default function CreateWorkspacePopup({
  onSuccess,
  onCancel,
}: CreateWorkspacePopupProps) {
  const [step, setStep] = useState<Step>("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const trimmedWorkspaceName = workspaceName.trim();
  const canCreateWorkspace = trimmedWorkspaceName.length > 0;
  const stepsCompleted = step === "form" ? 0 : step === "creating" ? 1 : 0;

  const createWorkspace = useCallback(async () => {
    setStep("creating");
    setErrorMessage("");

    const groupApi = new GroupApiDataSource();
    const configuredApplicationId = getApplicationId();

    try {
      const applicationId = await resolveApplicationId(configuredApplicationId);
      const groupResult = await groupApi.createGroup({
        applicationId,
        upgradePolicy: "LazyOnAccess",
        alias: trimmedWorkspaceName,
      });
      if (groupResult.error || !groupResult.data) {
        throw new Error(groupResult.error?.message || "Failed to create group");
      }
      const groupId = groupResult.data.groupId;
      setGroupId(groupId);

      // Allow all members to create contexts, invite others, and join open subgroups (0x0F = 0b1111)
      await groupApi.setDefaultCapabilities(groupId, { defaultCapabilities: 0x0F });

      const identityResult = await groupApi.resolveCurrentMemberIdentity(groupId);
      if (identityResult.data?.memberIdentity) {
        setGroupMemberIdentity(groupId, identityResult.data.memberIdentity);
      }

      onSuccess(groupId);
      return;
    } catch (error) {
      console.error("Create workspace failed:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
      setStep("error");
    }
  }, [trimmedWorkspaceName]);

  return (
    <Overlay>
      <PopupContainer>
        <StepIndicator>
          <StepDot $active={step === "form"} $done={stepsCompleted > 0} />
          <StepDot $active={step === "creating"} $done={stepsCompleted > 1} />
          <StepDot $active={false} $done={stepsCompleted > 2} />
        </StepIndicator>

        {step === "form" && (
          <>
            <Title>Create Namespace</Title>
            <Subtitle>
              Give your namespace a name. You can create channels and invite
              members once you enter.
            </Subtitle>
            <InputGroup>
              <Label htmlFor="workspaceName">Namespace name</Label>
              <Input
                id="workspaceName"
                type="text"
                placeholder="Enter a name"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                autoFocus
              />
            </InputGroup>
            <ButtonGroup>
              <Button
                onClick={createWorkspace}
                variant="primary"
                style={{ flex: 1 }}
                disabled={!canCreateWorkspace}
              >
                Create
              </Button>
              <Button onClick={onCancel} variant="secondary" style={{ flex: 1 }}>
                Cancel
              </Button>
            </ButtonGroup>
          </>
        )}

        {step === "creating" && (
          <>
            <Title>Creating namespace…</Title>
            <Message $type="info">
              Setting up your namespace. You'll be taken in automatically.
            </Message>
          </>
        )}

        {step === "error" && (
          <>
            <Title>Workspace Creation Failed</Title>
            <Message $type="error">{errorMessage}</Message>
            <ButtonGroup>
              <Button
                onClick={() => setStep("form")}
                variant="primary"
                style={{ flex: 1 }}
              >
                Try again
              </Button>
              <Button onClick={onCancel} variant="secondary" style={{ flex: 1 }}>
                Cancel
              </Button>
            </ButtonGroup>
          </>
        )}
      </PopupContainer>
    </Overlay>
  );
}
