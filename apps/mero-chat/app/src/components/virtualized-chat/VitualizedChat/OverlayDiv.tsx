import styled from "styled-components";

export const OverlayDiv = styled.div<{
  type?: "loading" | "noMessages";
}>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(14, 18, 34, 0.32)'
`;
