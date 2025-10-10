import { useCallback, useState } from "react";
import type { ActiveChat } from "../types/Common";
import Loader from "../components/loader/Loader";
import { styled } from "styled-components";
import type { ChannelInfo } from "../api/clientApi";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { timestampToDate } from "../utils/time";
import { Button } from "@calimero-network/mero-ui";

export const MessageJoinWrapper = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  @media (max-width: 1024px) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
  }
  .messageBoxHeader {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-family: Helvetica Neue;
    font-size: 20px;
    font-style: normal;
    font-weight: 500;
    line-height: 120%;
  }
  .messageBox,
  .backButton {
    font-family: Helvetica Neue;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
  }
  .messageBox {
    border-radius: 4px;
    padding: 16px 12px;
    align-items: center;
    text-align: center;
    font-size: 14px;
    color: #777583;
  }
  .wrapper {
    padding-top: 8px;
    padding-bottom: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .join-button {
    cursor: pointer;
    background-color: #5765f2;
    color: white;
    border-radius: 4px;
    font-family: Helvetica Neue;
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding: 6px 12px;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 190px;
    height: 40px;
    &:hover {
      background-color: #717cf0;
    }
  }
  .backButton {
    font-size: 12px;
    color: #fff;
    cursor: pointer;
  }
`;

interface JoinChannelProps {
  channelMeta: ChannelInfo;
  activeChat: ActiveChat;
  setIsOpenSearchChannel: () => void;
  onJoinedChat: () => void;
}

export default function JoinChannel({
  channelMeta,
  activeChat,
  setIsOpenSearchChannel,
  onJoinedChat,
}: JoinChannelProps) {
  const [loading, setLoading] = useState(false);
  const joinChannel = useCallback(async () => {
    setLoading(true);
    await new ClientApiDataSource().joinChannel({
      channel: { name: activeChat.name },
    });
    setLoading(false);
    onJoinedChat();
  }, [activeChat, onJoinedChat]);

  return (
    <MessageJoinWrapper>
      <div className="messageBox">
        <div className="messageBoxHeader">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="37"
            height="36"
            viewBox="0 0 37 36"
            fill="none"
          >
            <path
              d="M19.3775 28.458C19.357 28.5921 19.3457 28.7274 19.3438 28.863C19.3438 29.5492 19.8162 30.006 20.4688 30.006C21.0673 30.006 21.5758 29.619 21.7175 28.9327L22.964 22.851H25.673C26.6202 22.851 27.0613 22.3245 27.0613 21.6203C27.0613 20.9183 26.6382 20.4278 25.673 20.4278H23.4567L24.6178 14.7487H27.464C28.4315 14.7487 28.8545 14.238 28.8545 13.518C28.8545 12.8137 28.4315 12.339 27.464 12.339H25.1105L26.1815 7.155C26.2031 7.03312 26.2151 6.90975 26.2175 6.786C26.2193 6.63303 26.1905 6.48125 26.1328 6.33957C26.0751 6.19789 25.9897 6.06919 25.8815 5.96101C25.7733 5.85284 25.6446 5.76739 25.5029 5.70969C25.3613 5.65198 25.2095 5.62319 25.0565 5.625C24.7733 5.6196 24.4971 5.71333 24.2756 5.88999C24.0542 6.06666 23.9014 6.31515 23.8438 6.5925L22.667 12.339H17.6383L18.7115 7.155C18.7295 7.065 18.7453 6.8895 18.7453 6.786C18.7465 6.63186 18.7168 6.47903 18.6579 6.33658C18.599 6.19412 18.5121 6.06494 18.4024 5.95668C18.2926 5.84841 18.1623 5.76327 18.0191 5.7063C17.8758 5.64933 17.7226 5.62168 17.5685 5.625C17.2882 5.62337 17.016 5.71887 16.7982 5.89525C16.5804 6.07163 16.4304 6.31802 16.3737 6.5925L15.1925 12.339H12.6815C11.714 12.339 11.2932 12.834 11.2932 13.536C11.2932 14.238 11.714 14.7487 12.6815 14.7487H14.72L13.5612 20.4255H10.8703C9.923 20.4255 9.5 20.9183 9.5 21.6203C9.5 22.3245 9.923 22.851 10.8725 22.851H13.0685L11.9075 28.458C11.8895 28.548 11.8737 28.7392 11.8737 28.863C11.8737 29.5492 12.3462 30.006 12.9987 30.006C13.595 30.006 14.1058 29.619 14.2453 28.9327L15.494 22.851H20.5385L19.3797 28.458H19.3775ZM17.1275 14.7128H22.226L21.0672 20.4795H15.9328L17.1297 14.7128H17.1275Z"
              fill="white"
            />
          </svg>
          <span>{activeChat.name}</span>
        </div>
        {channelMeta &&
          channelMeta.created_by &&
          channelMeta.created_at &&
          `@${channelMeta.created_by_username} created this channel on ${timestampToDate(
            new Date(channelMeta.created_at * 1000).toISOString()
          )}`}
        <div className="wrapper">
          <Button onClick={joinChannel} style={{ width: "100%" }}>
            {loading ? <Loader size={16} /> : "Join Channel"}
          </Button>
        </div>
        <span className="backButton" onClick={setIsOpenSearchChannel}>
          Back to Browse Channels
        </span>
      </div>
    </MessageJoinWrapper>
  );
}
