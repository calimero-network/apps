// What each kind of secret holds, and which of its fields are sensitive.

/** The kinds a secret can be, and the fields each one carries. */
export const KINDS = [
  { id: 'login', label: 'Login' },
  { id: 'secure_note', label: 'Secure note' },
  { id: 'totp', label: 'Authenticator (TOTP)' },
  { id: 'ssh_key', label: 'SSH key' },
  { id: 'payment_card', label: 'Payment card' },
  { id: 'identity', label: 'Identity' },
] as const;

export type Kind = (typeof KINDS)[number]['id'];

interface FieldSpec {
  key: string;
  label: string;
  /** A long value gets a textarea; everything else a single line. */
  multiline?: boolean;
  /** Concealed while typing, and concealed on the vault page until revealed. */
  secret?: boolean;
  half?: boolean;
  /** Offer the password generator. */
  generate?: boolean;
  /** Validate as an authenticator seed or otpauth URI. */
  totp?: boolean;
}

export const FIELDS: Record<Kind, FieldSpec[]> = {
  login: [
    { key: 'username', label: 'Username', half: true },
    {
      key: 'password',
      label: 'Password',
      secret: true,
      half: true,
      generate: true,
    },
    { key: 'url', label: 'Website' },
    {
      key: 'totp',
      label: 'Authenticator seed or otpauth:// URI',
      secret: true,
      totp: true,
    },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
  secure_note: [{ key: 'notes', label: 'Note', multiline: true, secret: true }],
  totp: [
    {
      key: 'secret',
      label: 'Seed or otpauth:// URI',
      secret: true,
      totp: true,
    },
    { key: 'issuer', label: 'Issuer', half: true },
    { key: 'account', label: 'Account', half: true },
  ],
  ssh_key: [
    { key: 'private_key', label: 'Private key', multiline: true, secret: true },
    { key: 'public_key', label: 'Public key', multiline: true },
    { key: 'passphrase', label: 'Passphrase', secret: true, generate: true },
  ],
  payment_card: [
    { key: 'cardholder_name', label: 'Cardholder', half: true },
    { key: 'card_number', label: 'Card number', secret: true, half: true },
    { key: 'expiry_date', label: 'Expires', half: true },
    { key: 'cvv', label: 'CVV', secret: true, half: true },
    { key: 'pin', label: 'PIN', secret: true, half: true },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
  identity: [
    { key: 'full_name', label: 'Full name', half: true },
    { key: 'email', label: 'Email', half: true },
    { key: 'phone', label: 'Phone', half: true },
    {
      key: 'document_number',
      label: 'Passport / ID number',
      secret: true,
      half: true,
    },
    { key: 'address', label: 'Address', multiline: true },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
};

/** Whether `field` of a `kind` secret is concealed until revealed. */
export function isSensitive(kind: string, field: string): boolean {
  const spec = (FIELDS as Record<string, FieldSpec[]>)[kind]?.find(
    (f) => f.key === field,
  );
  return spec
    ? !!spec.secret
    : /pass|secret|key|cvv|pin|token|seed|private/i.test(field);
}

/** Whether `field` holds an authenticator seed. */
export function isTotpField(kind: string, field: string): boolean {
  const spec = (FIELDS as Record<string, FieldSpec[]>)[kind]?.find(
    (f) => f.key === field,
  );
  return !!spec?.totp;
}
