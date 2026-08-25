import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useDraft } from "../hooks/useDraft";
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
import { getContextId } from "@calimero-network/mero-react";
import type { ResponseData } from "../api/types";
import { getMeroJs } from "../api/meroJsClient";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { extractUsernames } from "../utils/mentions";
import { RichTextEditor } from "@calimero-network/mero-ui";

import { formatTyping, useEphemeralPresence } from "../hooks/useEphemeralPresence";
import { useToast } from "../contexts/ToastContext";

const MentionDropdown = styled.ul`
  position: absolute;
  bottom: calc(100% + 4px);
  left: 16px;
  right: 16px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  z-index: 200;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
`;

const MentionItem = styled.li<{ $active: boolean }>`
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  color: ${(p) => (p.$active ? "#fff" : "#aaa")};
  background: ${(p) => (p.$active ? "#2a2a2a" : "transparent")};
  &:hover {
    background: #2a2a2a;
    color: #fff;
  }
`;

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

const DraftBadge = styled.span`
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  letter-spacing: 0.04em;
  white-space: nowrap;
`;

const ReadOnlyField = styled.div<{ $banned?: boolean }>`
  background-color: ${(p) => (p.$banned ? "rgba(255, 59, 59, 0.07)" : "#111111")};
  border: 1px solid
    ${(p) => (p.$banned ? "rgba(255, 59, 59, 0.25)" : "transparent")};
  height: 2rem;
  border-radius: 4px;
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: ${(p) => (p.$banned ? 600 : 400)};
  line-height: 150%;
  color: ${(p) => (p.$banned ? "#ff6b6b" : "#797978")};
  flex: 1;
  @media (max-width: 1024px) {
    font-size: 14px;
  }
`;

/**
 * The strip under the composer. One slot, several possible occupants — see
 * `StatusBar` in the render for the precedence. Always mounted at a fixed
 * height so the composer never shifts as the occupant changes.
 */
export const StatusBar = styled.div`
  height: 18px;
  padding: 0 25px;
  font-size: 12px;
  line-height: 18px;
  color: #686672;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 1024px) {
    padding: 0 14px;
  }

  .typing {
    font-style: italic;
    color: #9ca3af;
  }

  .upload {
    color: #9ca3af;
  }

  .separator {
    color: #4b4954;
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
  /**
   * Stable key this conversation's draft is stored under.
   *
   * Separate from `selectedChat`, which is what the composer SHOWS. A channel
   * can use its name for both, but a DM is displayed by the counterpart's
   * display name — and a name is not an identity. Keying the draft on it meant
   * a rename silently orphaned the draft: still in storage, no longer
   * reachable, and no error to notice.
   */
  draftKey?: string;
  /** Channels are addressed as `#name`; a DM is addressed by the person. */
  isChannel?: boolean;
  contextId?: string;
  sendMessage: (payload: SendMessagePayload) => Promise<void> | void;
  resetImage: () => void;
  openThread: MessageWithReactions | undefined;
  isThread: boolean;
  isReadOnly: boolean;
  isOwner: boolean;
  isModerator: boolean;
  /// App-level (WASM) `Role::Banned`. Overrides isReadOnly / owner / mod —
  /// banned users can't write even if they'd otherwise have permission.
  isBanned?: boolean;
}

export default function MessageInput({
  selectedChat,
  draftKey,
  isChannel = false,
  contextId,
  sendMessage,
  resetImage,
  openThread,
  isThread,
  isReadOnly,
  isOwner,
  isModerator,
  isBanned,
}: MessageInputProps) {
  const [canWriteMessage, setCanWriteMessage] = useState(false);
  const {
    typing: typingNames,
    noteTyping,
    clearTyping,
  } = useEphemeralPresence(contextId ?? null);
  // Which kind of attachment is currently uploading, for the status bar. Two
  // independent UploadComponents report in, so each clears only its own kind —
  // a finishing file upload must not silently cancel an in-flight image one.
  const [uploadingKind, setUploadingKind] = useState<"image" | "file" | null>(
    null,
  );
  const handleImageUploading = useCallback((busy: boolean) => {
    setUploadingKind((prev) => (busy ? "image" : prev === "image" ? null : prev));
  }, []);
  const handleFileUploading = useCallback((busy: boolean) => {
    setUploadingKind((prev) => (busy ? "file" : prev === "file" ? null : prev));
  }, []);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState<MessageWithReactions | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSuggestions, setMentionSuggestions] = useState<{ name: string }[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const channelMembersRef = useRef<string[]>([]);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const { addToast } = useToast();
  // Drafts: disabled for thread replies to keep things simple.
  // Falls back to the displayed name only where no key was supplied, so a
  // caller that has not been updated keeps working rather than losing drafts.
  const draftScope = draftKey ?? selectedChat;
  const { draft: channelDraft, hasDraft, setDraft, clearDraft } = useDraft(
    isThread ? undefined : draftScope,
  );
  // Tracks which channel's draft has already been applied to the editor.
  const draftAppliedRef = useRef<string | undefined>(undefined);

  const deleteBlobById = useCallback(async (blobId?: string) => {
    if (!blobId) {
      return;
    }

    try {
      await getMeroJs().admin.deleteBlob(blobId);
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
  // "Message #general" / "Message User1" — a channel is a place and carries
  // the `#`, a DM is a person and does not. A thread says what it is rather
  // than where it is, so it keeps its own wording.
  const placeholderText = useMemo(() => {
    if (openThread && isThread) {
      return "Reply in thread";
    }
    return isChannel ? `Message #${selectedChat}` : `Message ${selectedChat}`;
  }, [openThread, isThread, isChannel, selectedChat]);

  // The composer takes ONE placeholder string, so the desktop/mobile variants
  // are chosen here. They used to be two elements toggled by a CSS breakpoint,
  // which only worked while the placeholder was rendered as its own node
  // below the input.
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1024px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    // Re-read on mount: the viewport can have changed between the lazy
    // initialiser and this effect.
    setIsNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const placeholderTextMobile = useMemo(() => {
    if (openThread && isThread) {
      return "Reply in thread";
    }
    const chatName =
      selectedChat.length === 44
        ? `${selectedChat.toLowerCase().slice(0, 6)}...${selectedChat.toLowerCase().slice(-4)}`
        : selectedChat;
    return isChannel ? `Message #${chatName}` : `Message ${chatName}`;
  }, [openThread, isThread, isChannel, selectedChat]);

  const resolvedContextId = useMemo(() => {
    if (contextId && contextId.length > 0) {
      return contextId;
    }
    return getContextId() ?? "";
  }, [contextId]);

  const handleMessageChange = useCallback(
    (mesage: MessageWithReactions | null) => {
      setMessage(mesage);
    },
    []
  );

  const detectMention = useCallback((html: string) => {
    const plain = html.replace(/<[^>]+>/g, "");
    const match = /@(\w*)$/.exec(plain);
    if (match) {
      const query = match[1];
      const filtered = channelMembersRef.current.filter((name) =>
        name.toLowerCase().startsWith(query.toLowerCase())
      );
      if (filtered.length > 0) {
        setMentionQuery(query);
        setMentionSuggestions(filtered.map((name) => ({ name })));
        setMentionHighlight(0);
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  }, []);

  const applyMention = useCallback(
    (name: string) => {
      const html = message?.text ?? "";
      // Match `@mentionQuery` only when NOT followed by more word chars (\w),
      // and only the last such occurrence. This prevents replacing `@john`
      // inside `@johnathan` when the query is `john`.
      const escaped = mentionQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`@${escaped}(?!\\w)(?=[^@]*$)`);
      if (!pattern.test(html)) {
        setShowMentions(false);
        return;
      }
      const newHtml = html.replace(pattern, `@${name} `);
      setMessage(
        message
          ? { ...message, text: newHtml }
          : {
              id: "",
              text: newHtml,
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
      if (!isThread) setDraft(newHtml);
      setShowMentions(false);
    },
    [message, mentionQuery, isThread, setDraft]
  );

  const handleMentionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showMentions) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight((i) => Math.min(i + 1, mentionSuggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (mentionSuggestions[mentionHighlight]) {
          e.preventDefault();
          applyMention(mentionSuggestions[mentionHighlight].name);
        }
      } else if (e.key === "Escape") {
        setShowMentions(false);
      }
    },
    [showMentions, mentionSuggestions, mentionHighlight, applyMention]
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

  const clearUploadedFile = useCallback(() => {
    setUploadedFile(null);
  }, [setUploadedFile]);

  const clearUploadedImage = useCallback(() => {
    setUploadedImage(null);
  }, [setUploadedImage]);

  useEffect(() => {
    setMessage(null);
    setEmojiSelectorOpen(false);
    setShowUpload(false);
    clearUploadedFile();
    clearUploadedImage();
    draftAppliedRef.current = undefined;
    setShowMentions(false);
    // Prefetch members for mention autocomplete.
    void new ClientApiDataSource()
      .getChannelMembers({ channel: { name: selectedChat } })
      .then((resp) => {
        if (resp.data) {
          channelMembersRef.current = Array.from(resp.data.values());
        }
      });
  }, [selectedChat, clearUploadedFile, clearUploadedImage]);

  // When a thread closes, reset the ref so the channel draft is re-applied.
  useEffect(() => {
    if (!isThread) draftAppliedRef.current = undefined;
  }, [isThread]);

  // Pre-populate the editor with the persisted draft when it loads.
  useEffect(() => {
    if (!channelDraft || isThread) return;
    if (draftAppliedRef.current === draftScope) return;
    draftAppliedRef.current = draftScope;
    setMessage({
      id: "",
      text: channelDraft,
      nonce: "",
      timestamp: Date.now(),
      sender: "",
      reactions: new Map(),
      files: [],
      images: [],
      thread_count: 0,
      thread_last_timestamp: 0,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelDraft]);

  const removeUploadedFile = useCallback(() => {
    if (uploadedFile?.file.blobId) {
      void deleteBlobById(uploadedFile.file.blobId);
    }
    setUploadedFile(null);
    setShowUpload(false);
  }, [deleteBlobById, setShowUpload, setUploadedFile, uploadedFile]);

  const removeUploadedImage = useCallback(() => {
    if (uploadedImage?.file.blobId) {
      void deleteBlobById(uploadedImage.file.blobId);
    }
    setUploadedImage(null);
    setShowUpload(false);
    resetImage();
  }, [deleteBlobById, resetImage, setShowUpload, setUploadedImage, uploadedImage]);

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
        clearTyping();
        if (!isThread) clearDraft();
        clearUploadedImage();
        clearUploadedFile();
        setShowUpload(false);
        setEmojiSelectorOpen(false);
        handleMessageChange(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send message";
        // "no mesh peers for namespace" means the message was stored locally but
        // P2P sync found no connected peers — expected with a single node.
        // Don't surface this as an error to the user.
        if (/mesh|no.*peer|peer.*sync/i.test(message)) {
          if (!isThread) clearDraft();
          clearUploadedImage();
          clearUploadedFile();
          setShowUpload(false);
          setEmojiSelectorOpen(false);
          handleMessageChange(null);
          return;
        }
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
      clearDraft,
      isThread,
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
    // Banned overrides everything else: even an owner who's been banned
    // (edge case but possible while we still allow self-ban in WASM) is
    // blocked from posting.
    if (isBanned) {
      setCanWriteMessage(false);
      return;
    }
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
  }, [isReadOnly, isModerator, isOwner, isBanned]);

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
        <Container style={customStyle} onKeyDown={handleMentionKeyDown}>
          {showMentions && mentionSuggestions.length > 0 && (
            <MentionDropdown>
              {mentionSuggestions.map((s, i) => (
                <MentionItem
                  key={s.name}
                  $active={i === mentionHighlight}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(s.name);
                  }}
                >
                  @{s.name}
                </MentionItem>
              ))}
            </MentionDropdown>
          )}
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
                  sendOnEnter={showMentions ? false : true}
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
                    if (!isThread) {
                      draftAppliedRef.current = draftScope;
                      setDraft(value);
                    }
                    detectMention(value);
                    // Empty composer means "stopped", not "typing slowly".
                    if (value.trim()) {
                      noteTyping();
                    } else {
                      clearTyping();
                    }
                  }}
                  onSend={showMentions ? undefined : handleSendMessageEnter}
                  placeholder={isNarrow ? placeholderTextMobile : placeholderText}
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
          </Wrapper>
          <ActionsWrapper>
            {hasDraft && !isThread && <DraftBadge>Draft</DraftBadge>}
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
                  onUploadingChange={handleImageUploading}
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
                  onUploadingChange={handleFileUploading}
                  key="files-component"
                />
              </UploadContainer>
            </UploadPopupContainer>
          )}
        </Container>
      )}
      {!canWriteMessage && (
        <Container style={customStyle}>
          <ReadOnlyField $banned={isBanned}>
            {isBanned
              ? "You are banned from this channel."
              : "You don’t have permissions to write in this channel"}
          </ReadOnlyField>
        </Container>
      )}
      {/*
        Status bar. Precedence, most transient first: what someone is doing
        right now beats what you could do. Typing is other people's live
        activity; the placeholder is the standing hint, shown when there is
        nothing more specific to say. Upload progress slots in above typing.
      */}
      <StatusBar aria-live="polite">
        {/*
          Upload and typing are independent facts, not competing ones — your
          attachment going up says nothing about whether someone else is
          writing — so both show, rather than one masking the other. The
          placeholder is NOT here: it belongs inside the composer, where a
          placeholder goes.
        */}
        {uploadingKind && (
          // Indeterminate by necessity: the upload is a single streaming PUT
          // and neither `fetch` nor the node reports progress, so a percentage
          // here could only be invented.
          <span className="upload">Uploading {uploadingKind}…</span>
        )}
        {uploadingKind && typingNames.length > 0 && (
          <span className="separator"> · </span>
        )}
        {typingNames.length > 0 && (
          <span className="typing">{formatTyping(typingNames)}</span>
        )}
      </StatusBar>
    </>
  );
}
