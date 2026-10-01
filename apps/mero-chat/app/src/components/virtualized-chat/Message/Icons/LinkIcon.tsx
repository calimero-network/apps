import styled from "styled-components";

const CustomSvg = styled.svg`
  @media (max-width: 1024px) {
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

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

const LinkIcon: React.FC = () => {
  return (
    <Container>
      <CustomSvg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g id="link">
          <path
            d="M7.3125 10.6875C7.6047 11.0781 7.97752 11.4013 8.40563 11.6353C8.83375 11.8693 9.30717 12.0086 9.79385 12.0439C10.2805 12.0792 10.7691 12.0096 11.2266 11.8399C11.6841 11.6702 12.0997 11.4043 12.4455 11.0602L14.4955 9.01017C15.1169 8.36674 15.4607 7.50499 15.4529 6.61054C15.4452 5.71609 15.0864 4.86045 14.454 4.22795C13.8215 3.59545 12.9658 3.23673 12.0714 3.22897C11.1769 3.22121 10.3152 3.56503 9.6718 4.18642L8.49668 5.35467"
            stroke="white"
            strokeWidth="1.125"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10.6875 7.3125C10.3953 6.92189 10.0225 6.59868 9.59437 6.36469C9.16626 6.13071 8.69284 5.99143 8.20616 5.95613C7.71947 5.92084 7.23085 5.99036 6.77337 6.16008C6.31589 6.32979 5.90031 6.59571 5.55451 6.93975L3.50451 8.98983C2.88312 9.63326 2.53931 10.495 2.54707 11.3895C2.55483 12.2839 2.91355 13.1396 3.54605 13.7721C4.17855 14.4046 5.03419 14.7633 5.92864 14.771C6.82308 14.7788 7.68484 14.435 8.32826 13.8136L9.4965 12.6453"
            stroke="white"
            strokeWidth="1.125"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </CustomSvg>
    </Container>
  );
};

export default LinkIcon;
