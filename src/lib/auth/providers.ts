/**
 * Optional upstream providers. Sign-in stays off unless this app is wired to one.
 */
export type SignInProvider = {
  providerId: string;
  idp: string;
  label: string;
};

export const SIGN_IN_PROVIDERS: readonly SignInProvider[] = [
  { providerId: "google", idp: "google", label: "Google" },
  { providerId: "x", idp: "twitter", label: "X" },
];
