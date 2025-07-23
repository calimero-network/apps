export const emptyText = /^(\s*<p><br><\/p>\s*)*$/;
export const markdownParser = (text: string) => {
  const toHTML = text.replace(
    /(\b(https?:\/\/[^\s<]+\/?)\b)|^(#####|####|###|##|#) (.*)$|(@everyone)|(@here)|(@[a-z\d]+[-_]*[a-z\d]+[-_]*[a-z\d]+\.(near|testnet))|<p><br><\/p>(?=\s*$)/gim,
    (
      match,
      url,
      url2,
      heading,
      text,
      everyoneMention,
      hereMention,
      validMention
    ) => {
      if (url || url2) {
        return `<a href="${url || url2}" class="url-link" target="_blank">${
          url || url2
        }</a>`;
      } else if (heading) {
        return text;
      } else if (everyoneMention) {
        return `<span class='mention-everyone'>@everyone</span>`;
      } else if (hereMention) {
        return `<span class='mention-here'>@here</span>`;
      } else if (validMention) {
        return `<span class='mention mention-user-${validMention
          .replace("@", "")
          .replace(/\./g, "\\.")
          .replace(/_/g, "\\_")}'>${validMention}</span>`;
      } else {
        return "";
      }
    }
  );

  return toHTML;
};
