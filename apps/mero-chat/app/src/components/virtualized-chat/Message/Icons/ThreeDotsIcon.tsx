import styled from "styled-components";

const Container = styled.div`
  cursor: pointer;
  color: #fff;
  @media (max-width: 1024px) {
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

const CustomSvg = styled.svg`
  @media (max-width: 1024px) {
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

const ThreeDotsIcon: React.FC = () => {
  return (
    <Container>
      <CustomSvg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g id="three-dots">
          <path
            id="Vector"
            d="M3.375 10.6875C2.92745 10.6875 2.49822 10.5097 2.18176 10.1932C1.86529 9.87678 1.6875 9.44755 1.6875 9C1.6875 8.55245 1.86529 8.12322 2.18176 7.80676C2.49822 7.49029 2.92745 7.3125 3.375 7.3125C3.82255 7.3125 4.25178 7.49029 4.56824 7.80676C4.88471 8.12322 5.0625 8.55245 5.0625 9C5.0625 9.44755 4.88471 9.87678 4.56824 10.1932C4.25178 10.5097 3.82255 10.6875 3.375 10.6875ZM9 10.6875C8.55245 10.6875 8.12322 10.5097 7.80676 10.1932C7.49029 9.87678 7.3125 9.44755 7.3125 9C7.3125 8.55245 7.49029 8.12322 7.80676 7.80676C8.12322 7.49029 8.55245 7.3125 9 7.3125C9.44755 7.3125 9.87678 7.49029 10.1932 7.80676C10.5097 8.12322 10.6875 8.55245 10.6875 9C10.6875 9.44755 10.5097 9.87678 10.1932 10.1932C9.87678 10.5097 9.44755 10.6875 9 10.6875ZM14.625 10.6875C14.1774 10.6875 13.7482 10.5097 13.4318 10.1932C13.1153 9.87678 12.9375 9.44755 12.9375 9C12.9375 8.55245 13.1153 8.12322 13.4318 7.80676C13.7482 7.49029 14.1774 7.3125 14.625 7.3125C15.0726 7.3125 15.5018 7.49029 15.8182 7.80676C16.1347 8.12322 16.3125 8.55245 16.3125 9C16.3125 9.44755 16.1347 9.87678 15.8182 10.1932C15.5018 10.5097 15.0726 10.6875 14.625 10.6875Z"
            fill="white"
          />
        </g>
      </CustomSvg>
    </Container>
  );
};

export default ThreeDotsIcon;
