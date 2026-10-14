import { useState } from "react";
import styled from "styled-components";
import {
  NotificationCenter,
  useNotifications,
  type Notification,
} from "@calimero-network/mero-ui";

const NotificationButton = styled.button`
  position: relative;
  background: transparent;
  border: none;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: background-color 0.2s;

  &:hover {
    background-color: color-mix(in srgb, var(--glass-ink) 10%, transparent);
  }

  svg {
    fill: var(--glass-muted);
    width: 20px;
    height: 20px;
  }

  &:hover svg {
    fill: var(--glass-ink);
  }
`;

const NotificationBadge = styled.span`
  position: absolute;
  top: 4px;
  right: 4px;
  background-color: var(--glass-ink);
  color: var(--glass-on-ink);
  border-radius: 10px;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  padding: 0 4px;
`;

const NotificationDropdown = styled.div<{ $isOpen: boolean }>`
  position: absolute;
  top: 60px;
  right: 20px;
  width: 400px;
  max-height: 600px;
  background-color: var(--glass-surface-solid);
  border: 1px solid var(--glass-line);
  border-radius: 12px;
  box-shadow: var(--chat-pop-shadow);
  z-index: 1000;
  display: ${(props) => (props.$isOpen ? "block" : "none")};

  @media (max-width: 768px) {
    width: calc(100vw - 40px);
    right: 20px;
    left: 20px;
  }
`;

const BellIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
  </svg>
);

export default function NotificationCenterWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    markAsRead,
    archive,
    archiveAll,
    deleteNotification,
    clearAll,
  } = useNotifications();

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    // You can add navigation logic here based on notification type
  };

  return (
    <>
      <NotificationButton
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <NotificationBadge>{unreadCount}</NotificationBadge>
        )}
      </NotificationButton>

      <NotificationDropdown $isOpen={isOpen}>
        <NotificationCenter
          notifications={notifications}
          onNotificationClick={handleNotificationClick}
          onMarkAsRead={markAsRead}
          onArchive={archive}
          onArchiveAll={archiveAll}
          onDelete={deleteNotification}
          onClearAll={clearAll}
          maxNotifications={50}
          groupByDate={true}
        />
      </NotificationDropdown>

      {/* Overlay to close dropdown when clicking outside */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
