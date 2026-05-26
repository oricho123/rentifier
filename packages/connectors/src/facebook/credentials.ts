declare const process: { env: Record<string, string | undefined> };

export interface FacebookCredentials {
  email: string;
  password: string;
}

export function isAutoLoginEnabled(): boolean {
  return process.env.FB_AUTO_LOGIN_ENABLED === 'true';
}

export function loadCredentials(accountId: string): FacebookCredentials | null {
  const scopedEmail = process.env[`FB_EMAIL_${accountId}`];
  const scopedPassword = process.env[`FB_PASSWORD_${accountId}`];

  if (scopedEmail && scopedPassword) {
    return { email: scopedEmail, password: scopedPassword };
  }

  if (scopedEmail || scopedPassword) {
    return null;
  }

  const accountCount = process.env.FB_ACCOUNT_COUNT;
  if (accountCount === '1') {
    const sharedEmail = process.env.FB_EMAIL;
    const sharedPassword = process.env.FB_PASSWORD;
    if (sharedEmail && sharedPassword) {
      return { email: sharedEmail, password: sharedPassword };
    }
  }

  return null;
}
