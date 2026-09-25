import type { UserId } from "../api/clientApi";

// Helper function to extract just usernames from users map
export function extractUsernames(
  users: Map<string, string> | Record<string, string> | null | undefined,
): string[] {
  if (!users) return [];

  if (users instanceof Map) {
    return Array.from(users.values());
  } else {
    return Object.values(users);
  }
}

export function extractAndAddMentions(
  message: string,
  users: Map<string, string> | Record<string, string> | null | undefined,
): {
  userIdMentions: UserId[];
  usernameMentions: string[];
} {
  // users <public_key, username>
  // mentions from username (value)
  const regexPattern = /(@everyone)|(@here)|(@[a-zA-Z\s]+)/g;
  const uniqueUserIdMentions = new Set<string>();
  const uniqueUsernameMentions = new Set<string>();
  let match;

  if (!users) {
    return {
      userIdMentions: [],
      usernameMentions: [],
    };
  }

  const userEntries =
    users instanceof Map ? Array.from(users.entries()) : Object.entries(users);

  while ((match = regexPattern.exec(message)) !== null) {
    const mention = match[0].slice(1).trim();

    if (mention === "everyone" || mention === "here") {
      uniqueUsernameMentions.add(mention);
      continue;
    }

    for (const [userId, username] of userEntries) {
      if (username.toLowerCase() === mention.toLowerCase()) {
        uniqueUserIdMentions.add(userId);
        uniqueUsernameMentions.add(username);
        break;
      }
    }
  }

  return {
    userIdMentions: Array.from(uniqueUserIdMentions) as UserId[],
    usernameMentions: Array.from(uniqueUsernameMentions),
  };
}
