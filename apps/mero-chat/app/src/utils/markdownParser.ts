export const emptyText = /^(\s*<p><br><\/p>\s*)*$/;
export const markdownParser = (text: string, channelMembers: string[]) => {
  // First pass: handle urls, headings, everyone/here
  let toHTML = text.replace(
    /^(#####|####|###|##|#) (.*)$|(@everyone)|(@here)|<p><br><\/p>(?=\s*$)/gim,
    (match, heading, headingText, everyoneMention, hereMention) => {
      if (heading) {
        return headingText;
      } else if (everyoneMention) {
        return `<span class='mention-everyone'>@everyone</span>`;
      } else if (hereMention) {
        return `<span class='mention-here'>@here</span>`;
      } else {
        return "";
      }
    },
  );

  // Second pass: handle @mentions by looking for channel members in the message
  channelMembers.forEach((member) => {
    const mentionPattern = new RegExp(
      `@${member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "gi",
    );
    toHTML = toHTML.replace(mentionPattern, () => {
      const normalizedClass = member
        .replace(/\s+/g, "")
        .toLowerCase()
        .replace(/\./g, "\\.")
        .replace(/_/g, "\\_");

      return `<span class="mention mention-user-${normalizedClass}">@${member}</span>`;
    });
  });

  return toHTML;
};
