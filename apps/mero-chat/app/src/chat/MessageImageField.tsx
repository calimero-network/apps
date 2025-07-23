import type { FileObject } from "../types/Common";
import { styled } from "styled-components";

interface MessageImageFieldProps {
  file: FileObject;
  resetImage: () => void;
}

const RemoveButton = styled.div`
  position: relative;
  top: 0;
  right: 16px;
  z-index: 20;
  cursor: pointer;
`;

const ResetFileIcon = ({ resetFile }: { resetFile: () => void }) => {
  return (
    <RemoveButton onClick={resetFile}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="#fff"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_972_45209)">
          <path
            d="M12 6C12 7.5913 11.3679 9.11742 10.2426 10.2426C9.11742 11.3679 7.5913 12 6 12C4.4087 12 2.88258 11.3679 1.75736 10.2426C0.632141 9.11742 0 7.5913 0 6C0 4.4087 0.632141 2.88258 1.75736 1.75736C2.88258 0.632141 4.4087 0 6 0C7.5913 0 9.11742 0.632141 10.2426 1.75736C11.3679 2.88258 12 4.4087 12 6ZM4.0155 3.4845C3.94509 3.41408 3.84958 3.37453 3.75 3.37453C3.65042 3.37453 3.55491 3.41408 3.4845 3.4845C3.41408 3.55491 3.37453 3.65042 3.37453 3.75C3.37453 3.84958 3.41408 3.94509 3.4845 4.0155L5.46975 6L3.4845 7.9845C3.44963 8.01937 3.42198 8.06076 3.40311 8.10631C3.38424 8.15187 3.37453 8.20069 3.37453 8.25C3.37453 8.29931 3.38424 8.34813 3.40311 8.39369C3.42198 8.43924 3.44963 8.48063 3.4845 8.5155C3.55491 8.58591 3.65042 8.62547 3.75 8.62547C3.79931 8.62547 3.84813 8.61576 3.89369 8.59689C3.93924 8.57802 3.98063 8.55037 4.0155 8.5155L6 6.53025L7.9845 8.5155C8.01937 8.55037 8.06076 8.57802 8.10631 8.59689C8.15187 8.61576 8.20069 8.62547 8.25 8.62547C8.29931 8.62547 8.34813 8.61576 8.39369 8.59689C8.43924 8.57802 8.48063 8.55037 8.5155 8.5155C8.55037 8.48063 8.57802 8.43924 8.59689 8.39369C8.61576 8.34813 8.62547 8.29931 8.62547 8.25C8.62547 8.20069 8.61576 8.15187 8.59689 8.10631C8.57802 8.06076 8.55037 8.01937 8.5155 7.9845L6.53025 6L8.5155 4.0155C8.55037 3.98063 8.57802 3.93924 8.59689 3.89369C8.61576 3.84813 8.62547 3.79931 8.62547 3.75C8.62547 3.70069 8.61576 3.65187 8.59689 3.60631C8.57802 3.56076 8.55037 3.51937 8.5155 3.4845C8.48063 3.44963 8.43924 3.42198 8.39369 3.40311C8.34813 3.38424 8.29931 3.37453 8.25 3.37453C8.20069 3.37453 8.15187 3.38424 8.10631 3.40311C8.06076 3.42198 8.01937 3.44963 7.9845 3.4845L6 5.46975L4.0155 3.4845Z"
            fill="white"
          />
        </g>
        <defs>
          <clipPath id="clip0_972_45209">
            <rect width="12" height="12" fill="white" />
          </clipPath>
        </defs>
      </svg>
    </RemoveButton>
  );
};

const ImageWrapper = styled.div`
  display: flex;
  height: 64px;
  width: 64px;
  margin-left: 8px;
  margin-bottom: 8px;
`;

export default function MessageImageField({
  file,
  resetImage,
}: MessageImageFieldProps) {
  if (!file) return null;
  const cid = file?.cid;
  return (
    <ImageWrapper>
      <img
        src={`https://ipfs.near.social/ipfs/${cid}`}
        alt="uploaded"
        height="64px"
        width="64px"
        style={{
          maxHeight: "64px",
          maxWidth: "64px",
        }}
      />
      <ResetFileIcon resetFile={resetImage} />
    </ImageWrapper>
  );
}
