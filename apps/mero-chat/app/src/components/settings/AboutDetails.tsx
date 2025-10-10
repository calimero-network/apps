import React from "react";
import styled from "styled-components";
import { timestampToDate } from "../../utils/time";

interface AboutDetailsProps {
  channelName: string;
  dateCreated: string;
  manager: string;
  handleLeaveChannel: () => void;
}

interface SettingsItemProps {
  $borderbottom?: boolean;
  $roundedTop?: boolean;
  $roundedBottom?: boolean;
}

interface TextProps {
  $red?: boolean;
}

const SettingsItem = styled.div<SettingsItemProps>`
  display: flex;
  gap: 0.5rem;
  background-color: #0e0e10;
  padding-left: 1rem;
  ${({ $borderbottom }) => $borderbottom && "border-bottom: 1px solid #282933;"}
  ${({ $roundedTop }) =>
    $roundedTop &&
    "border-top-left-radius: 0.375rem; border-top-right-radius: 0.375rem;"}
    ${({ $roundedBottom }) =>
    $roundedBottom &&
    "border-bottom-left-radius: 0.375rem; border-bottom-right-radius: 0.375rem;"}
`;

const Text = styled.h6<TextProps>`
  ${({ $red }) =>
    $red ? "color: #DC3545; :hover { color: #f76560 }" : "color: #FFF;"}
  /* Body/Regular */
    font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 24px */
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
  padding: 0;
`;

const ButtonLeave = styled.button`
  background-color: transparent;
  border: none;
  padding: 0rem;
  margin: 0rem;
  cursor: pointer;
`;

const AboutDetails: React.FC<AboutDetailsProps> = (props) => {
  return (
    <>
      <SettingsItem $borderbottom $roundedTop>
        <Text>Created</Text>
        <Text>
          {props.dateCreated ? timestampToDate(props.dateCreated) : "N/A"}
        </Text>
      </SettingsItem>
      <SettingsItem $borderbottom>
        <Text>Managed by</Text>
        <Text>{props.manager}</Text>
      </SettingsItem>
      <SettingsItem $roundedBottom>
        {props.channelName !== "general" && <ButtonLeave>
          <Text $red={true} onClick={props.handleLeaveChannel}>
            Leave Channel
          </Text>
        </ButtonLeave>}
      </SettingsItem>
    </>
  );
};

export default AboutDetails;
