import { styled } from "styled-components";
import type { FileObject } from "../types/Common";

const FileContainer = styled.div`
  min-width: 197px;
  max-width: 197px;
  position: relative;
  width: fit-content;
  background-color: #1D1D21;
  display: flex;
  gap: 4px;,
  border-radius: 2px;
  padding: 4px;
  cursor: poiner;
  margin-left: 4px;
  margin-bottom: 4px;
`;

const IconContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4E95FF;
  border-radius: 2px;
  width: 2rem;
  height: 2rem;
  padding: 0.5rem:
`;

const FileInfo = styled.div`
  display: flex;
  flex-direction: column;
`;

const FileTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 130px;
  -webkit-font-smoothing: antialiased applied;
`;

const FileExtension = styled.div`
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 100%;
  color: #5c5c71;
`;

const FileIcon = ({ className }: { className: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill="white"
    className={className ?? 'bi bi-file-earmark-fill'}
    viewBox="0 0 16 16"
  >
    <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z" />
  </svg>
);

const RemoveButton = styled.div`
  position: relative;
  top: -4px;
  right: -4px;
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
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_955_44892)">
          <path
            d="M12 6C12 7.5913 11.3679 9.11742 10.2426 10.2426C9.11742 11.3679 7.5913 12 6 12C4.4087 12 2.88258 11.3679 1.75736 10.2426C0.632141 9.11742 0 7.5913 0 6C0 4.4087 0.632141 2.88258 1.75736 1.75736C2.88258 0.632141 4.4087 0 6 0C7.5913 0 9.11742 0.632141 10.2426 1.75736C11.3679 2.88258 12 4.4087 12 6ZM4.0155 3.4845C3.94509 3.41408 3.84958 3.37453 3.75 3.37453C3.65042 3.37453 3.55491 3.41408 3.4845 3.4845C3.41408 3.55491 3.37453 3.65042 3.37453 3.75C3.37453 3.84958 3.41408 3.94509 3.4845 4.0155L5.46975 6L3.4845 7.9845C3.44963 8.01937 3.42198 8.06076 3.40311 8.10631C3.38424 8.15187 3.37453 8.20069 3.37453 8.25C3.37453 8.29931 3.38424 8.34813 3.40311 8.39369C3.42198 8.43924 3.44963 8.48063 3.4845 8.5155C3.55491 8.58591 3.65042 8.62547 3.75 8.62547C3.79931 8.62547 3.84813 8.61576 3.89369 8.59689C3.93924 8.57802 3.98063 8.55037 4.0155 8.5155L6 6.53025L7.9845 8.5155C8.01937 8.55037 8.06076 8.57802 8.10631 8.59689C8.15187 8.61576 8.20069 8.62547 8.25 8.62547C8.29931 8.62547 8.34813 8.61576 8.39369 8.59689C8.43924 8.57802 8.48063 8.55037 8.5155 8.5155C8.55037 8.48063 8.57802 8.43924 8.59689 8.39369C8.61576 8.34813 8.62547 8.29931 8.62547 8.25C8.62547 8.20069 8.61576 8.15187 8.59689 8.10631C8.57802 8.06076 8.55037 8.01937 8.5155 7.9845L6.53025 6L8.5155 4.0155C8.55037 3.98063 8.57802 3.93924 8.59689 3.89369C8.61576 3.84813 8.62547 3.79931 8.62547 3.75C8.62547 3.70069 8.61576 3.65187 8.59689 3.60631C8.57802 3.56076 8.55037 3.51937 8.5155 3.4845C8.48063 3.44963 8.43924 3.42198 8.39369 3.40311C8.34813 3.38424 8.29931 3.37453 8.25 3.37453C8.20069 3.37453 8.15187 3.38424 8.10631 3.40311C8.06076 3.42198 8.01937 3.44963 7.9845 3.4845L6 5.46975L4.0155 3.4845Z"
            fill="white"
          />
        </g>
        <defs>
          <clipPath id="clip0_955_44892">
            <rect width="12" height="12" fill="white" />
          </clipPath>
        </defs>
      </svg>
    </RemoveButton>
  );
};

interface MessageFileFieldProps {
  file: FileObject;
  resetFile: () => void;
}

export default function MessageFileField({ file, resetFile }: MessageFileFieldProps) {
  if (!file) return null;
  const fileName = file?.name;
  return (
    <FileContainer>
      <IconContainer>
        <FileIcon className="bi bi-file-earmark-fill" />
      </IconContainer>
      {fileName && (
        <FileInfo>
          <FileTitle>{fileName}</FileTitle>
          <FileExtension>
            {fileName.split('.').pop()?.toUpperCase()}
          </FileExtension>
        </FileInfo>
      )}
      <ResetFileIcon resetFile={resetFile} />
    </FileContainer>
  );
}
