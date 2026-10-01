import styled from "styled-components";

export const OverlayDiv = styled.div<{
  type?: "loading" | "noMessages";
}>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.5)'
`;
