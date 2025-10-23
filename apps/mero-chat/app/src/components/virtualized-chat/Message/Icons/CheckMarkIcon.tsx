import styled from "styled-components";

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 24px;
  height: 24px;
  @media (max-width: 1024px) {
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

const CheckMarkIcon: React.FC = () => {
  return (
    <Container>
      <span>✅</span>
    </Container>
  );
};

export default CheckMarkIcon;
