import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { styled } from "styled-components";
import type {
  AttachmentDraft,
  ChatFile,
  MessageWithReactions,
  SendMessagePayload,
} from "../types/Common";
import EmojiSelector from "../emojiSelector/EmojiSelector";
import { emptyText, markdownParser } from "../utils/markdownParser";
import UploadComponent, {
  FileUploadIcon,
  ImageUploadIcon,
} from "./UploadComponent";
import MessageFileField from "./MessageFileField";
import MessageImageField from "./MessageImageField";
import {
  blobClient,
  getContextId,
  type ResponseData,
} from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { extractUsernames } from "../utils/mentions";
import { RichTextEditor } from "@calimero-network/mero-ui";
import { getDmContextId } from "../utils/session";
import { useToast } from "../contexts/ToastContext";

export const EditorWrapper = styled.div`
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;

  .full-width-editor {
    width: 100% !important;
    max-width: 100% !important;
    word-wrap: break-word !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
  }

  .full-width-editor > div {
    width: 100% !important;
    max-width: 100% !important;
    word-wrap: break-word !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
  }

  .full-width-editor .ql-editor {
    width: 100% !important;
    max-width: 100% !important;
    word-wrap: break-word !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    white-space: pre-wrap !important;
  }
`;

const Container = styled.div`
  width: 100%;
  padding-left: 16px;
  padding-right: 16px;
  padding-top: 1px;
  padding-bottom: 10px;
  display: flex;
  align-items: end;
  z-index: 10;
  transform: translateZ(0);
  @media (min-width: 1025px) {
    gap: 8px;
    border-radius: 4px;
    /* Prevent layout shifts when modals open on desktop */
    will-change: transform;
    backface-visibility: hidden;
    /* Ensure the element stays in place when modals open */
    isolation: isolate;
  }
  @media (max-width: 1024px) {
    margin: 0 !important;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    gap: 4px;
    margin: 0px;
    padding-left: 8px;
    padding-right: 8px;
    padding-bottom: 12px;
    padding-top: 0px;
    width: 100% !important;
    transform: translateZ(0);
    /* Prevent layout shifts when modals open */
    will-change: transform;
    backface-visibility: hidden;
  }
`;

const EmojiPopupContainer = styled.div`
  position: absolute;
  bottom: 70px;
  right: 2.5rem;
  z-index: 1000;
`;

const UploadPopupContainer = styled.div`
  position: absolute;
  bottom: 46px;
  right: 108px;
  z-index: 1000;
  @media (max-width: 1024px) {
    right: 88px;
    bottom: 52px;
  }
`;

const UploadContainer = styled.div`
  background-color: rgb(17, 17, 17);
  border-radius: 4px;
  border: 1px solid rgb(42, 42, 42);
`;

const Wrapper = styled.div`
  flex: 1;
  display: flex;
  align-items: start;
  background-color: #111111;
  min-width: 0;
`;

export const FullWidthWrapper = styled.div`
  display: flex;
  flex-direction: row;
  overflow: hidden;
  align-items: start;
  width: 100%;
  flex: 1;
  min-width: 0; /* This is crucial for flex items to shrink */
`;

const EmojiContainer = styled.div`
  border-radius: 2px;
  margin-bottom: 4px;
  height: 26px;
  width: 26px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2px;
  cursor: pointer;

  .hidden-svg {
    visibility: hidden;
    position: absolute;
    z-index: -10;
  }

  .visible-svg {
    visibility: visible;
  }
`;

export const IconEmoji = () => {
  const [hovered, setHovered] = useState(false);

  return (
    <EmojiContainer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        fill="#686672"
        className={`bi bi-emoji-wink ${hovered ? "hidden-svg" : "visible-svg"}`}
        viewBox="0 0 16 16"
      >
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
        <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm1.757-.437a.5.5 0 0 1 .68.194.934.934 0 0 0 .813.493c.339 0 .645-.19.813-.493a.5.5 0 1 1 .874.486A1.934 1.934 0 0 1 10.25 7.75c-.73 0-1.356-.412-1.687-1.007a.5.5 0 0 1 .194-.68z" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        fill="#73B30C"
        className={`bi bi-emoji-wink-fill ${
          hovered ? "visible-svg" : "hidden-svg"
        }`}
        viewBox="0 0 16 16"
      >
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM7 6.5C7 5.672 6.552 5 6 5s-1 .672-1 1.5S5.448 8 6 8s1-.672 1-1.5zM4.285 9.567a.5.5 0 0 0-.183.683A4.498 4.498 0 0 0 8 12.5a4.5 4.5 0 0 0 3.898-2.25.5.5 0 1 0-.866-.5A3.498 3.498 0 0 1 8 11.5a3.498 3.498 0 0 1-3.032-1.75.5.5 0 0 0-.683-.183zm5.152-3.31a.5.5 0 0 0-.874.486c.33.595.958 1.007 1.687 1.007.73 0 1.356-.412 1.687-1.007a.5.5 0 0 0-.874-.486.934.934 0 0 1-.813.493.934.934 0 0 1-.813-.493z" />
      </svg>
    </EmojiContainer>
  );
};

export const IconUploadSvg = styled.div`
  width: 26px;
  height: 26px;
  display: flex;
  justify-content: center;
  align-items: start;
  cursor: pointer;

  svg {
    fill: #686672;
  }

  .stroke-path {
    stroke: #686672;
  }

  &:hover {
    svg {
      fill: #73b30c;
    }

    .stroke-path {
      stroke: #73b30c;
      fill: #73b30c;
    }
  }
`;

export const IconUpload = ({ onClick }: { onClick: () => void }) => (
  <IconUploadSvg onClick={onClick}>
    <svg
      width="20px"
      height="20px"
      viewBox="0 0 24 24"
      fill="#686672"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.5 3H12H8C6.34315 3 5 4.34315 5 6V18C5 19.6569 6.34315 21 8 21H12M13.5 3L19 8.625M13.5 3V7.625C13.5 8.17728 13.9477 8.625 14.5 8.625H19M19 8.625V11.8125"
        className="stroke-path"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 21L17.5 15M17.5 15L20 17.5M17.5 15L15 17.5"
        className="stroke-path"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </IconUploadSvg>
);

export const IconSendSvg = styled.svg`
  margin-bottom: 8px;
  :hover {
    fill: #73b30c;
  }
  cursor: pointer;
`;
export const IconSend = ({
  onClick,
  isActive,
}: {
  onClick: () => void;
  isActive: boolean;
}) => (
  <IconSendSvg
    onClick={onClick}
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill={`${isActive ? "#73B30C" : "#686672"}`}
    className="bi bi-send-fill"
    viewBox="0 0 16 16"
  >
    <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z" />
  </IconSendSvg>
);

const Placeholder = styled.div<{
  $placeholderPosition: string;
  $placeholderPositionMobile: string;
}>`
  position: absolute;
  z-index: 10;
  bottom: ${({ $placeholderPosition }) =>
    $placeholderPosition && $placeholderPosition};
  left: 25px;
  color: #686672;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  pointer-events: none;
  @media (max-width: 1024px) {
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    bottom: -10px;
    left: 14px;
  }

  &.desktop {
    display: block;
  }

  &.mobile {
    display: none;
  }

  @media (max-width: 1024px) {
    &.desktop {
      display: none;
    }

    &.mobile {
      display: block;
    }
  }
`;

const ReadOnlyField = styled.div`
  background-color: #111111;
  height: 2rem;
  border-radius: 4px;
  padding: 4px 8px 4px 8px;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  color: #797978;
  flex: 1;
  @media (max-width: 1024px) {
    font-size: 14px;
    display: flex;
    align-items: center;
  }
`;

export const ActionsWrapper = styled.div`
  position: absolute;
  right: 24px;
  bottom: 20px;
  @media (min-width: 1025px) {
    right: 42px;
    bottom: 12px;
  }
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`;

const AttachmentPreviewContainer = styled.div`
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  right: 24px;
  top: 32px;
`;

interface MessageInputProps {
  selectedChat: string;
  contextId?: string;
  sendMessage: (payload: SendMessagePayload) => Promise<void> | void;
  resetImage: () => void;
  openThread: MessageWithReactions | undefined;
  isThread: boolean;
  isReadOnly: boolean;
  isOwner: boolean;
  isModerator: boolean;
}

export default function MessageInput({
  selectedChat,
  contextId,
  sendMessage,
  resetImage,
  openThread,
  isThread,
  isReadOnly,
  isOwner,
  isModerator,
}: MessageInputProps) {
  const [canWriteMessage, setCanWriteMessage] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState<MessageWithReactions | null>(null);
  const [uploadedFileState, setUploadedFileState] = useState<ChatFile | null>(
    null
  );
  const [uploadedImageState, setUploadedImageState] = useState<ChatFile | null>(
    null
  );
  const uploadedFile = uploadedFileState;
  const uploadedImage = uploadedImageState;
  const setUploadedFile = useCallback((file: ChatFile | null) => {
    setUploadedFileState((prev) => {
      if (prev?.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return file;
    });
  }, []);
  const setUploadedImage = useCallback((file: ChatFile | null) => {
    setUploadedImageState((prev) => {
      if (prev?.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return file;
    });
  }, []);
  const [emojiSelectorOpen, setEmojiSelectorOpen] = useState(false);
  const placeholderPosition = "-10px";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const { addToast } = useToast();

  const deleteBlobById = useCallback(async (blobId?: string) => {
    if (!blobId) {
      return;
    }

    try {
      const response = await blobClient.deleteBlob(blobId);
      if (response?.error) {
        console.error("MessageInput", "Failed to delete blob", response.error);
      }
    } catch (error) {
      console.error("MessageInput", "Failed to delete blob", error);
    }
  }, []);

  const handleUploadError = useCallback(
    (message: string | null) => {
      if (!message) {
        return;
      }

      addToast({
        title: "Upload error",
        message: `Error while uploading file: ${message}`,
        type: "channel",
        duration: 5000,
      });
    },
    [addToast]
  );

  const handleReplaceImage = useCallback(
    async (previous: ChatFile | null) => {
      if (!previous) {
        return;
      }
      await deleteBlobById(previous.file.blobId);
      setUploadedImage(null);
    },
    [deleteBlobById, setUploadedImage]
  );

  const handleReplaceFile = useCallback(
    async (previous: ChatFile | null) => {
      if (!previous) {
        return;
      }
      await deleteBlobById(previous.file.blobId);
      setUploadedFile(null);
    },
    [deleteBlobById, setUploadedFile]
  );

  // Memoize placeholder text to avoid recalculation
  const placeholderText = useMemo(() => {
    if (openThread && isThread) {
      return "Reply in thread";
    }
    return `Type message in ${selectedChat}`;
  }, [openThread, isThread, selectedChat]);

  const placeholderTextMobile = useMemo(() => {
    if (openThread && isThread) {
      return "Reply in thread";
    }
    const chatName =
      selectedChat.length === 44
        ? `${selectedChat.toLowerCase().slice(0, 6)}...${selectedChat.toLowerCase().slice(-4)}`
        : selectedChat;
    return `Type message in ${chatName}`;
  }, [openThread, isThread, selectedChat]);

  const resolvedContextId = useMemo(() => {
    if (contextId && contextId.length > 0) {
      return contextId;
    }
    return getContextId() ?? getDmContextId() ?? "";
  }, [contextId]);

  const handleMessageChange = useCallback(
    (mesage: MessageWithReactions | null) => {
      setMessage(mesage);
    },
    []
  );

  const handleEmojiSelected = useCallback((emoji: string) => {
    editorRef.current?.insertContent(emoji);
  }, []);

  const toggleEmojiPopup = useCallback(() => {
    setEmojiSelectorOpen((prev) => {
      const next = !prev;
      if (next) {
        setShowUpload(false);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setMessage(null);
    setEmojiSelectorOpen(false);
    setShowUpload(false);
    clearUploadedFile();
    clearUploadedImage();
  }, [selectedChat]);

  const removeUploadedFile = useCallback(() => {
    if (uploadedFile?.file.blobId) {
      void deleteBlobById(uploadedFile.file.blobId);
    }
    setUploadedFile(null);
    setShowUpload(false);
  }, [deleteBlobById, setShowUpload, uploadedFile]);

  const removeUploadedImage = useCallback(() => {
    if (uploadedImage?.file.blobId) {
      void deleteBlobById(uploadedImage.file.blobId);
    }
    setUploadedImage(null);
    setShowUpload(false);
    resetImage();
  }, [deleteBlobById, resetImage, setShowUpload, uploadedImage]);

  const clearUploadedFile = useCallback(() => {
    setUploadedFile(null);
  }, [setUploadedFile]);

  const clearUploadedImage = useCallback(() => {
    setUploadedImage(null);
  }, [setUploadedImage]);

  useEffect(() => {
    return () => {
      if (uploadedFile?.previewUrl) {
        URL.revokeObjectURL(uploadedFile.previewUrl);
      }
      if (uploadedImage?.previewUrl) {
        URL.revokeObjectURL(uploadedImage.previewUrl);
      }
    };
  }, [uploadedFile, uploadedImage]);

  const hasText = useMemo(() => {
    const content = message?.text ?? "";
    if (!content) {
      return false;
    }
    return !emptyText.test(markdownParser(content, []));
  }, [message]);

  const hasAttachments = Boolean(uploadedImage || uploadedFile);

  const isActive = hasText;

  const buildAttachmentDraft = useCallback(
    (chatFile: ChatFile | null): AttachmentDraft | null => {
      if (!chatFile?.file?.blobId) {
        return null;
      }

      return {
        blobId: chatFile.file.blobId,
        name: chatFile.file.name,
        size: chatFile.file.size,
        mimeType: chatFile.file.type,
        previewUrl: chatFile.previewUrl,
        uploadedAt: chatFile.file.uploadedAt,
      };
    },
    []
  );

  const sendPayload = useCallback(
    async (content: string) => {
      const rawContent = content ?? "";
      const fileDraft = buildAttachmentDraft(uploadedFile);
      const imageDraft = buildAttachmentDraft(uploadedImage);

      const isEmptyContent =
        !rawContent ||
        rawContent.trim() === "" ||
        rawContent === "<p></p>" ||
        rawContent === "<p><br></p>" ||
        rawContent
          .replace(/<p><\/p>/g, "")
          .replace(/<p><br><\/p>/g, "")
          .trim() === "" ||
        emptyText.test(markdownParser(rawContent, []));

      if (isEmptyContent) {
        handleMessageChange(null);
        return;
      }

      let tagList: string[] = [];
      try {
        const channelUsers: ResponseData<Map<string, string>> =
          await new ClientApiDataSource().getChannelMembers({
            channel: { name: selectedChat },
          });
        if (channelUsers.data) {
          tagList = extractUsernames(channelUsers.data);
        }
      } catch (error) {
        console.error("MessageInput", "Failed to fetch channel members", error);
      }

      const payload: SendMessagePayload = {
        text: markdownParser(rawContent ?? "", tagList),
        files: fileDraft ? [fileDraft] : [],
        images: imageDraft ? [imageDraft] : [],
      };

      try {
        await sendMessage(payload);
        clearUploadedImage();
        clearUploadedFile();
        setShowUpload(false);
        setEmojiSelectorOpen(false);
        handleMessageChange(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send message";
        addToast({
          title: "Message error",
          message,
          type: "channel",
          duration: 5000,
        });
      }
    },
    [
      buildAttachmentDraft,
      uploadedFile,
      uploadedImage,
      selectedChat,
      sendMessage,
      clearUploadedImage,
      clearUploadedFile,
      setShowUpload,
      setEmojiSelectorOpen,
      handleMessageChange,
      addToast,
    ]
  );

  const handleSendMessage = async () => {
    await sendPayload(message?.text ?? "");
  };

  const handleSendMessageEnter = async (content: string) => {
    await sendPayload(content ?? "");
  };

  const handleAttachmentUploaded = useCallback(() => {
    setShowUpload(false);
  }, [setShowUpload]);

  const toggleUploadPopup = useCallback(() => {
    setShowUpload((prev) => !prev);
    setEmojiSelectorOpen(false);
  }, [setShowUpload, setEmojiSelectorOpen]);

  useEffect(() => {
    setCanWriteMessage(false);
    if (isReadOnly) {
      if (isModerator || isOwner) {
        setCanWriteMessage(true);
      } else {
        setCanWriteMessage(false);
      }
    } else {
      setCanWriteMessage(true);
    }
  }, [isReadOnly, isModerator, isOwner]);

  // Memoize custom style to avoid recalculation on every render
  const customStyle = useMemo(() => {
    const style = {
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box" as const,
    };
    if (openThread && !isThread) {
      style.width = "100%"; // Main chat input should use full width when thread is open
    } else if (openThread && isThread) {
      style.width = "100%"; // Thread input should use full width
    }
    return style;
  }, [openThread, isThread]);

  return (
    <>
      {canWriteMessage && (
        <Container style={customStyle}>
          <Wrapper>
            <FullWidthWrapper>
              <EditorWrapper
                style={{
                  flex: 1,
                  width: "100%",
                  minWidth: 0,
                }}
              >
                <RichTextEditor
                  ref={editorRef}
                  value={message?.text ?? ""}
                  sendOnEnter={true}
                  clearOnSend={true}
                  onChange={(value: string) => {
                    setMessage(
                      message
                        ? { ...message, text: value }
                        : {
                            id: "",
                            text: value,
                            nonce: "",
                            timestamp: Date.now(),
                            sender: "",
                            reactions: new Map(),
                            files: [],
                            images: [],
                            thread_count: 0,
                            thread_last_timestamp: 0,
                          }
                    );
                  }}
                  onSend={handleSendMessageEnter}
                  placeholder={placeholderText}
                  maxHeight={50}
                  style={{ fontSize: "14px" }}
                  className="full-width-editor"
                />
              </EditorWrapper>
              {hasAttachments && (
                <AttachmentPreviewContainer>
                  {uploadedImage && (
                    <MessageImageField
                      file={uploadedImage.file}
                      previewUrl={uploadedImage.previewUrl}
                      onRemove={removeUploadedImage}
                      contextId={resolvedContextId}
                      isInput={true}
                      containerSize={45}
                    />
                  )}
                  {uploadedFile && (
                    <MessageFileField
                      file={uploadedFile.file}
                      onRemove={removeUploadedFile}
                    />
                  )}
                </AttachmentPreviewContainer>
              )}
            </FullWidthWrapper>
            <>
              <Placeholder
                $placeholderPosition={placeholderPosition}
                $placeholderPositionMobile={placeholderPosition}
                className="desktop"
              >
                {placeholderText}
              </Placeholder>
              <Placeholder
                $placeholderPosition={placeholderPosition}
                $placeholderPositionMobile={placeholderPosition}
                className="mobile"
              >
                {placeholderTextMobile}
              </Placeholder>
            </>
          </Wrapper>
          <ActionsWrapper>
            <IconUpload onClick={toggleUploadPopup} />
            <div onClick={toggleEmojiPopup}>
              <IconEmoji />
            </div>
            <IconSend
              onClick={() => {
                handleSendMessage();
              }}
              isActive={!!isActive}
            />
            {emojiSelectorOpen && (
              <EmojiPopupContainer>
                <EmojiSelector onEmojiSelected={handleEmojiSelected} />
              </EmojiPopupContainer>
            )}
          </ActionsWrapper>
          {showUpload && (
            <UploadPopupContainer>
              <UploadContainer>
                <UploadComponent
                  uploadedFile={uploadedImage}
                  setUploadedFile={setUploadedImage}
                  type={["image/jpeg", "image/png", "image/gif"]}
                  icon={<ImageUploadIcon />}
                  text={uploadedImage ? "Replace Image" : "Upload Image"}
                  onError={handleUploadError}
                  onUploaded={handleAttachmentUploaded}
                  onReplace={handleReplaceImage}
                  key="images-component"
                />
                <UploadComponent
                  uploadedFile={uploadedFile}
                  setUploadedFile={setUploadedFile}
                  type={["*/*"]}
                  icon={<FileUploadIcon />}
                  text={uploadedFile ? "Replace File" : "Upload File"}
                  onError={handleUploadError}
                  onUploaded={handleAttachmentUploaded}
                  onReplace={handleReplaceFile}
                  key="files-component"
                />
              </UploadContainer>
            </UploadPopupContainer>
          )}
        </Container>
      )}
      {!canWriteMessage && (
        <Container style={customStyle}>
          <ReadOnlyField>
            You don&apos;t have permissions to write in this channel
          </ReadOnlyField>
        </Container>
      )}
    </>
  );
}
