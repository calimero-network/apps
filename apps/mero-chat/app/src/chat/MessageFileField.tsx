import { styled } from "styled-components";
import type { FileObject } from "../types/Common";

const FileContainer = styled.div<{ $truncate: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background-color: #1d1d21;
  border: 1px solid #3e3e42;
  border-radius: 6px;
  padding: 6px;
  margin: 4px 6px 0 0;
  max-width: ${({ $truncate }) => ($truncate ? "160px" : "100%")};
  height: 46px;
  box-sizing: border-box;
`;

const IconContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #73b30c;
  border-radius: 4px;
  width: 32px;
  height: 32px;
`;

const FileInfo = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
  gap: 4px;
`;

const FileTitle = styled.span<{ $truncate: boolean }>`
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  line-height: 140%;
  white-space: ${({ $truncate }) => ($truncate ? "nowrap" : "normal")};
  overflow: ${({ $truncate }) => ($truncate ? "hidden" : "visible")};
  text-overflow: ${({ $truncate }) => ($truncate ? "ellipsis" : "clip")};
`;

const ButtonGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const IconButton = styled.button`
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
`;

const DownloadButton = styled(IconButton)`
  color: #73b30c;
  font-size: 16px;
  padding: 0 3px;
`;

const CloseButton = styled(IconButton)`
  color: #ff6b6b;
  font-size: 16px;
  padding: 0 3px;
`;

const FileIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill="white"
    className={className ?? "bi bi-file-earmark-fill"}
    viewBox="0 0 16 16"
  >
    <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z" />
  </svg>
);

function formatDisplayName(name?: string, truncate = true): string {
  if (!name) return "file";
  if (!truncate) return name;
  const parts = name.split(".");
  const ext = parts.length > 1 ? `.${parts.pop()}` : "";
  const base = parts.join(".");
  const truncated = base.length > 2 ? `${base.slice(0, 2)}…` : base;
  return `${truncated}${ext}`;
}

interface MessageFileFieldProps {
  file: FileObject;
  onRemove?: () => void;
  onDownload?: () => void;
  truncate?: boolean;
}

export default function MessageFileField({
  file,
  onRemove,
  onDownload,
  truncate = true,
}: MessageFileFieldProps) {
  if (!file) return null;

  return (
    <FileContainer $truncate={truncate}>
      <IconContainer>
        <FileIcon />
      </IconContainer>
      <FileInfo>
        <FileTitle $truncate={truncate}>{formatDisplayName(file.name, truncate)}</FileTitle>
        <ButtonGroup>
          {onDownload && (
            <DownloadButton aria-label="Download attachment" onClick={onDownload}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 4v10m0 0 4-4m-4 4-4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5 18h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </DownloadButton>
          )}
          {onRemove && (
            <CloseButton aria-label="Remove attachment" onClick={onRemove}>
              ×
            </CloseButton>
          )}
        </ButtonGroup>
      </FileInfo>
    </FileContainer>
  );
}
