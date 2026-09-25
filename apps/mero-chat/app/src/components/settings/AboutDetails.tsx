import React from "react";
import styled from "styled-components";
import { timestampToDate } from "../../utils/time";
import Loader from "../loader/Loader";

interface AboutDetailsProps {
  channelName: string;
  dateCreated: string;
  manager: string;
  isOwner?: boolean;
  handleDeleteChannel?: () => void;
  isDeleting?: boolean;
}

const InfoCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 0.75rem;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.65rem 0.875rem;

  & + & {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
`;

const InfoLabel = styled.span`
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
`;

const InfoValue = styled.span`
  font-size: 0.78rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  max-width: 60%;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ActionButton = styled.button<{ $danger?: boolean }>`
  width: 100%;
  padding: 0.6rem 0.875rem;
  background: rgba(255, 59, 59, 0.07);
  border: 1px solid rgba(255, 59, 59, 0.2);
  border-radius: 10px;
  color: #ff6b6b;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;

  &:hover:not(:disabled) {
    background: rgba(255, 59, 59, 0.12);
    border-color: rgba(255, 59, 59, 0.35);
    color: #ff8585;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  & + & {
    margin-top: 0.5rem;
  }
`;

const AboutDetails: React.FC<AboutDetailsProps> = (props) => {
  return (
    <>
      <InfoCard>
        <InfoRow>
          <InfoLabel>Created</InfoLabel>
          <InfoValue>{props.dateCreated ? timestampToDate(props.dateCreated) : "N/A"}</InfoValue>
        </InfoRow>
        <InfoRow>
          <InfoLabel>Managed by</InfoLabel>
          <InfoValue>{props.manager || "—"}</InfoValue>
        </InfoRow>
      </InfoCard>
      {props.isOwner && (
        <ActionButton
          type="button"
          onClick={props.handleDeleteChannel}
          disabled={props.isDeleting}
        >
          <span>{props.isDeleting ? "Deleting…" : "Delete Channel"}</span>
          {props.isDeleting && <Loader size={16} />}
        </ActionButton>
      )}
    </>
  );
};

export default AboutDetails;
