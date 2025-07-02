import type { ActiveChat, ChannelMeta, User, MessageWithReactions } from "../types/Common";

export const mockDMActiveChat: ActiveChat = {
  type: "direct_message",
  id: "1",
  name: "John Doe",
  account: "0x1234567890",
};

export const mockChannelActiveChat: ActiveChat = {
  type: "channel",
  id: "1",
  name: "Channel 1",
};

export const mockChannelUsers: User[] = [
  {
    id: "1",
    name: "Fran",
    moderator: true,
    active: true,
  },
  {
    id: "2",
    name: "John",
    moderator: false,
    active: true,
  },
  {
    id: "3",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "4",
    name: "John",
    moderator: false,
    active: false,
  },
  {
    id: "5",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "6",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "7",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "8",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "9",
    name: "Jane",
    moderator: false,
    active: false,
  },
  {
    id: "10",
    name: "Jane",
    moderator: false,
    active: false,
  },
];

export const defaultActiveChat: ActiveChat = {
  type: "channel",
  id: "1",
  name: "general",
  readOnly: false,
};

export const mockChannels: ChannelMeta[] = [
  {
    name: "general",
    type: "channel",
    description: "Company-wide general discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "announcements",
    type: "channel",
    description: "Company-wide announcements and updates",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: true,
  },
  {
    name: "engineering",
    type: "channel",
    description: "Engineering team discussions and collaboration",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "design",
    type: "channel",
    description: "Design team collaboration and feedback",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "marketing",
    type: "channel",
    description: "Marketing campaigns and strategies",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "sales",
    type: "channel",
    description: "Sales team discussions and leads",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "product",
    type: "channel",
    description: "Product management and planning discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "hr",
    type: "channel",
    description: "Human resources and company policies",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "finance",
    type: "channel",
    description: "Financial discussions and budget planning",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "random",
    type: "channel",
    description: "Casual conversations and memes",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "watercooler",
    type: "channel",
    description: "Social conversations and team bonding",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "help",
    type: "channel",
    description: "General help and questions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "dev-ops",
    type: "channel",
    description: "DevOps and infrastructure discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "frontend",
    type: "channel",
    description: "Frontend development and UI discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "backend",
    type: "channel",
    description: "Backend development and API discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "qa",
    type: "channel",
    description: "Quality assurance and testing discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "releases",
    type: "channel",
    description: "Product release notifications and updates",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: true,
  },
  {
    name: "security",
    type: "channel",
    description: "Security discussions and incident reports",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "legal",
    type: "channel",
    description: "Legal matters and compliance discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
  {
    name: "customer-support",
    type: "channel",
    description: "Customer service and support discussions",
    members: mockChannelUsers,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "admin",
    owner: "admin",
    inviteOnly: false,
    channelType: "Public",
    unreadMessages: {
      count: 0,
      mentions: 0,
    },
    isMember: true,
    readOnly: false,
  },
];

export const mockMessages: MessageWithReactions[] = [
  {
    id: "msg-1",
    text: "Hey everyone! 👋 How's the project going?",
    nonce: "nonce-1",
    timestamp: Date.now() - 3600000, // 1 hour ago
    sender: "1",
    reactions: new Map([
      ["👍", ["2", "3"]],
      ["❤️", ["1"]]
    ]),
    files: [],
    images: [],
    thread_count: 3,
    thread_last_timestamp: Date.now() - 1800000,
  },
  {
    id: "msg-2",
    text: "Great progress on the frontend! The new UI looks amazing 🎨",
    nonce: "nonce-2",
    timestamp: Date.now() - 3000000, // 50 minutes ago
    sender: "2",
    reactions: new Map([
      ["🚀", ["1", "3", "4"]],
      ["👏", ["2"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "msg-3",
    text: "Just deployed the latest version to staging. Everything looks good!",
    nonce: "nonce-3",
    timestamp: Date.now() - 2400000, // 40 minutes ago
    sender: "3",
    reactions: new Map([
      ["✅", ["1", "2"]],
      ["🎉", ["3"]]
    ]),
    files: [],
    images: [],
    thread_count: 1,
    thread_last_timestamp: Date.now() - 1200000,
  },
  {
    id: "msg-4",
    text: "Anyone up for a quick code review? I've got some changes ready.",
    nonce: "nonce-4",
    timestamp: Date.now() - 1800000, // 30 minutes ago
    sender: "1",
    reactions: new Map([
      ["👀", ["2", "3"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "msg-5",
    text: "I'm available! Send me the PR link 📝",
    nonce: "nonce-5",
    timestamp: Date.now() - 1200000, // 20 minutes ago
    sender: "2",
    reactions: new Map([
      ["👍", ["1"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "msg-6",
    text: "Perfect! Here's the link: https://github.com/company/project/pull/123",
    nonce: "nonce-6",
    timestamp: Date.now() - 600000, // 10 minutes ago
    sender: "1",
    reactions: new Map(),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "msg-7",
    text: "Thanks! I'll take a look at it right away 🔍",
    nonce: "nonce-7",
    timestamp: Date.now() - 300000, // 5 minutes ago
    sender: "2",
    reactions: new Map([
      ["👌", ["1"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "msg-8",
    text: "Don't forget about the team meeting at 3 PM today! 📅",
    nonce: "nonce-8",
    timestamp: Date.now() - 60000, // 1 minute ago
    sender: "3",
    reactions: new Map([
      ["⏰", ["1", "2", "4"]],
      ["📝", ["3"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  }
];

export const mockThreadMessages: MessageWithReactions[] = [
  {
    id: "thread-1",
    text: "This is a reply in the thread!",
    nonce: "thread-nonce-1",
    timestamp: Date.now() - 1800000,
    sender: "2",
    reactions: new Map([
      ["👍", ["1"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "thread-2",
    text: "Another reply here",
    nonce: "thread-nonce-2",
    timestamp: Date.now() - 1200000,
    sender: "3",
    reactions: new Map(),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  },
  {
    id: "thread-3",
    text: "And one more reply to complete the thread",
    nonce: "thread-nonce-3",
    timestamp: Date.now() - 600000,
    sender: "1",
    reactions: new Map([
      ["🎯", ["2"]]
    ]),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  }
];

// Mock functions for VirtualizedChat
export const mockLoadInitialMessages = () => {
  console.log("Mock: Loading initial messages");
  return Promise.resolve(mockMessages);
};

export const mockLoadPrevMessages = (id: string) => {
  console.log("Mock: Loading previous messages before", id);
  // Return some older messages
  const olderMessages = mockMessages.map(msg => ({
    ...msg,
    id: `older-${msg.id}`,
    timestamp: msg.timestamp - 86400000 // 1 day older
  }));
  return Promise.resolve(olderMessages);
};

export const mockReadMessage = (message: MessageWithReactions) => {
  console.log("Mock: Reading message", message.id);
  // Simulate marking message as read
  return Promise.resolve();
};

export const mockHandleReaction = (message: MessageWithReactions, emoji: string) => {
  console.log("Mock: Handling reaction", emoji, "on message", message.id);
  // Simulate adding/removing reaction
  const currentReactions = message.reactions.get(emoji) || [];
  const currentUser = "1"; // Mock current user ID
  
  if (currentReactions.includes(currentUser)) {
    // Remove reaction
    message.reactions.set(emoji, currentReactions.filter(id => id !== currentUser));
  } else {
    // Add reaction
    message.reactions.set(emoji, [...currentReactions, currentUser]);
  }
  
  return Promise.resolve();
};

export const mockSendMessage = (message: string) => {
  console.log("Mock: Sending message", message);
  // Simulate sending message
  const newMessage: MessageWithReactions = {
    id: `new-msg-${Date.now()}`,
    text: message,
    nonce: `nonce-${Date.now()}`,
    timestamp: Date.now(),
    sender: "1", // Mock current user
    reactions: new Map(),
    files: [],
    images: [],
    thread_count: 0,
    thread_last_timestamp: 0,
  };
  
  return Promise.resolve(newMessage);
};

export const mockGetIconFromCache = (accountId: string) => {
  console.log("Mock: Getting icon for user", accountId);
  // Return a mock avatar URL
  const avatars = [
    "https://i.imgur.com/e8buxpa.png",
    "https://i.imgur.com/abc123.png",
    "https://i.imgur.com/def456.png",
    "https://i.imgur.com/ghi789.png"
  ];
  const index = parseInt(accountId) % avatars.length;
  return avatars[index];
};
