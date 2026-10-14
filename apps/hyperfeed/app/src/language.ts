/**
 * The language your agent answers in, kept as one standing rule in a fixed
 * wording, so it needs nothing new in the contract and reaches every turn the
 * way every other rule does. No such rule means English: mero-bot adds that
 * line itself when your rules name no language.
 */

export const DEFAULT_LANGUAGE = "English";

/** The languages offered in Settings → Rules, by their English name, with what each calls itself. */
export const LANGUAGES: { name: string; native: string }[] = [
  { name: "English", native: "English" },
  { name: "Spanish", native: "Español" },
  { name: "French", native: "Français" },
  { name: "German", native: "Deutsch" },
  { name: "Italian", native: "Italiano" },
  { name: "Portuguese", native: "Português" },
  { name: "Dutch", native: "Nederlands" },
  { name: "Polish", native: "Polski" },
  { name: "Czech", native: "Čeština" },
  { name: "Swedish", native: "Svenska" },
  { name: "Serbian", native: "Srpski" },
  { name: "Croatian", native: "Hrvatski" },
  { name: "Slovenian", native: "Slovenščina" },
  { name: "Greek", native: "Ελληνικά" },
  { name: "Turkish", native: "Türkçe" },
  { name: "Ukrainian", native: "Українська" },
  { name: "Russian", native: "Русский" },
  { name: "Arabic", native: "العربية" },
  { name: "Hebrew", native: "עברית" },
  { name: "Hindi", native: "हिन्दी" },
  { name: "Indonesian", native: "Bahasa Indonesia" },
  { name: "Vietnamese", native: "Tiếng Việt" },
  { name: "Chinese", native: "中文" },
  { name: "Japanese", native: "日本語" },
  { name: "Korean", native: "한국어" },
];

const WORDING = /^always respond in (.+?) unless the user writes in another language\.?$/i;

/** The rule that sets `language`. */
export function languageRule(language: string): string {
  return `Always respond in ${language.trim()} unless the user writes in another language.`;
}

/** The language a rule sets, or null when it is any other rule. */
export function languageOf(text: string): string | null {
  const m = WORDING.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const said = (m[1] ?? "").trim();
  return LANGUAGES.find((l) => l.name.toLowerCase() === said.toLowerCase())?.name ?? said;
}
