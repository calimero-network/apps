import styled from "styled-components";

const HeaderContainer = styled.div`
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #777583;
  font-size: 12px;
  padding: 0;
  margin: 0;
`;

interface LoadingHeaderProps {
  isLoading: boolean;
}

// Following VirtuosoMessageList pattern - don't inline custom components
// Reference: https://virtuoso.dev/virtuoso-message-list/tutorial/loading-older-messages/
const LoadingHeader: React.FC<LoadingHeaderProps> = ({ isLoading }) => {
  // Return empty div to avoid layout shift (Virtuoso best practice)
  return (
    <HeaderContainer>
      {isLoading ? "Loading older messages..." : ""}
    </HeaderContainer>
  );
};

export default LoadingHeader;
