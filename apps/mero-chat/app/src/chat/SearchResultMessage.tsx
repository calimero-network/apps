import { useMemo, useCallback } from "react";
import { styled } from "styled-components";
import type { CurbFile, CurbMessage, FileObject } from "../types/Common";
import Avatar from "../components/virtualized-chat/Message/Avatar";
import RenderHtml from "../components/virtualized-chat/Message/RenderHtml";
import MessageImageField from "./MessageImageField";
import MessageFileField from "./MessageFileField";
import { blobClient } from "@calimero-network/calimero-client";
import { MessageText } from "../components/virtualized-chat/Message";

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #ffffff;

  .msg-content {
    color: #ffffff;
    font-size: 14px;
    line-height: 1.5;

    p,
    span,
    div,
    li {
      color: #ffffff;
    }

    a {
      color: #a8b7ff;
      text-decoration: underline;
    }
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const AvatarWrapper = styled.div`
  flex-shrink: 0;
`;

const SenderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const SenderName = styled.div`
  color: #ffffff;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SenderId = styled.div`
  color: #777583;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
`;

const Timestamp = styled.div`
  margin-left: auto;
  color: #b2b1bb;
  font-size: 12px;
  white-space: nowrap;
`;

const EmptyBody = styled.div`
  font-size: 13px;
  color: #777583;
`;

const Attachments = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

interface SearchResultMessageProps {
  message: CurbMessage;
  contextId?: string;
  avatarSrc?: string | null;
}

const toFileObject = (attachment: CurbFile): FileObject => ({
  blobId: attachment.ipfs_cid,
  name: attachment.name ?? "Attachment",
  size: attachment.size ?? 0,
  type: attachment.mime_type ?? "application/octet-stream",
  uploadedAt: attachment.uploaded_at,
});

export default function SearchResultMessage({
  message,
  contextId,
}: SearchResultMessageProps) {
  const displayName = message.senderUsername || message.sender;
  const timestampLabel = useMemo(
    () =>
      new Date(message.timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [message.timestamp]
  );

  const imageAttachments = useMemo(
    () =>
      (message.images ?? []).map((attachment, index) => ({
        key: `${attachment.ipfs_cid}-${index}`,
        file: toFileObject(attachment),
        previewUrl: attachment.preview_url,
      })),
    [message.images]
  );

  const fileAttachments = useMemo(
    () =>
      (message.files ?? []).map((attachment, index) => ({
        key: `${attachment.ipfs_cid}-${index}`,
        attachment,
        file: toFileObject(attachment),
      })),
    [message.files]
  );

  const hasGlobalMention = useMemo(() => {
    return (
      message.text?.includes("mention-everyone") ||
      message.text?.includes("mention-here") ||
      message.text?.includes(`mention-user-${message.sender}`)
    );
  }, [message.text, message.sender]);

  const escapedAccountId = useMemo(() => {
    return message.sender.replace(/\./g, "\\.").replace(/_/g, "\\_");
  }, [message.sender]);

  const handleFileDownload = useCallback(
    async (attachment: CurbFile) => {
      if (!contextId) return;

      try {
        const blob = await blobClient.downloadBlob(
          attachment.ipfs_cid,
          contextId
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name ?? "attachment";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error("SearchResultMessage", "Failed to download file", error);
      }
    },
    [contextId]
  );

  return (
    <Wrapper>
      <Header>
        <AvatarWrapper>
          <Avatar
            size="md"
            name={displayName || message.sender}
            alt={displayName || message.sender}
          />
        </AvatarWrapper>
        <SenderBlock>
          <SenderName>{displayName}</SenderName>
          <SenderId>{message.sender}</SenderId>
        </SenderBlock>
        <Timestamp>{timestampLabel}</Timestamp>
      </Header>
      {message.text ? (
        <MessageText
          $globalMention={hasGlobalMention}
          $accountId={escapedAccountId}
        >
          <RenderHtml html={message.text} />
        </MessageText>
      ) : (
        <EmptyBody>This message has no text content.</EmptyBody>
      )}
      {(imageAttachments.length > 0 || fileAttachments.length > 0) && (
        <Attachments>
          {imageAttachments.map(({ key, file, previewUrl }) => (
            <MessageImageField
              key={key}
              file={file}
              previewUrl={previewUrl}
              contextId={contextId}
              containerSize={96}
              isInput={false}
            />
          ))}
          {fileAttachments.map(({ key, file, attachment }) => (
            <MessageFileField
              key={key}
              file={file}
              truncate={false}
              onDownload={() => handleFileDownload(attachment)}
            />
          ))}
        </Attachments>
      )}
    </Wrapper>
  );
}
