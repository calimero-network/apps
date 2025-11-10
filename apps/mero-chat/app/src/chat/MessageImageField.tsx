import { useEffect, useState } from "react";
import { styled } from "styled-components";
import type { FileObject } from "../types/Common";
import { blobClient } from "@calimero-network/calimero-client";
import { PhotoProvider, PhotoView } from "react-photo-view";

const ImageWrapper = styled.div<{ $size: number }>`
  position: relative;
  display: inline-flex;
  margin: 4px 8px 4px 0;
  border-radius: 6px;
  overflow: hidden;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  background-color: #1d1d21;
  border: 1px solid #25252a;
  cursor: pointer;
`;

const StyledImg = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const Placeholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  border-radius: 6px;
  background-color: #25252a;
  color: #7a7a85;
  font-size: 12px;
`;

interface MessageImageFieldProps {
  file: FileObject;
  previewUrl?: string;
  isInput: boolean;
  onRemove?: () => void;
  contextId?: string;
  containerSize: number;
}

const HoverContainer = styled.div`
  position: absolute;
  top: 4px;
  right: 4px;
  background-color: rgba(0, 0, 0, 0.7);
  border-radius: 4px;
  padding: 4px;
`;

const HoverContainerRemove = styled.div`
  position: absolute;
  top: 1px;
  right: 1px;
  background-color: rgba(0, 0, 0, 0.7);
  border-radius: 4px;
  padding: 1px;
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

const RemoveButton = styled(IconButton)`
  color: #ff6b6b;
  font-size: 16px;
  padding: 0 3px;
`;

export default function MessageImageField({
  file,
  previewUrl,
  isInput,
  onRemove,
  contextId,
  containerSize,
}: MessageImageFieldProps) {
  const [imageSrc, setImageSrc] = useState<string | undefined>(previewUrl);
  const [isLoading, setIsLoading] = useState(!previewUrl);
  const [hasError, setHasError] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [blockHovering, setBlockHovering] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const { innerWidth: width } = window;
      if (width < 1024) {
        setIsHovering(true);
        setBlockHovering(true);
      } else {
        setIsHovering(false);
      }
    };
    handleResize();
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;

    if (!previewUrl && contextId && file.blobId) {
      setIsLoading(true);
      setHasError(false);

      blobClient
        .downloadBlob(file.blobId, contextId)
        .then((blob) => {
          if (!blob) {
            setHasError(true);
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          setImageSrc(objectUrl);
        })
        .catch(() => {
          setHasError(true);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (!previewUrl) {
      setIsLoading(false);
      if (!contextId) {
        setHasError(true);
      }
    }

    return () => {
      if (!previewUrl && objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewUrl, contextId, file.blobId]);

  const handleDownload = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!contextId || !file.blobId) {
      return;
    }

    try {
      const blob = await blobClient.downloadBlob(file.blobId, contextId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "image";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("MessageImageField", "Failed to download image", error);
    }
  };

  if (hasError) {
    return <Placeholder>Failed to load image</Placeholder>;
  }

  if (isLoading && !imageSrc) {
    return <Placeholder>Loading…</Placeholder>;
  }

  if (!imageSrc) {
    return null;
  }

  return (
    <PhotoProvider>
      <ImageWrapper
        $size={containerSize}
        onMouseEnter={() => {
          if (!blockHovering) {
            setIsHovering(true);
          }
        }}
        onMouseLeave={() => {
          if (!blockHovering) {
            setIsHovering(false);
          }
        }}
      >
        <PhotoView src={imageSrc}>
          <div>
            <StyledImg src={imageSrc} alt={file.name || "attachment"} />
            {!isInput && isHovering && (
              <HoverContainer>
                <DownloadButton
                  aria-label="Download attachment"
                  onClick={handleDownload}
                >
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
              </HoverContainer>
            )}
            {isInput && isHovering && (
              <HoverContainerRemove>
                <RemoveButton aria-label="Remove attachment" onClick={onRemove}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M6 18L18 6M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </RemoveButton>
              </HoverContainerRemove>
            )}
          </div>
        </PhotoView>
      </ImageWrapper>
    </PhotoProvider>
  );
}
