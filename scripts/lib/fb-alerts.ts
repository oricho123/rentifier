import type { LoginOutcome } from '@rentifier/connectors/src/facebook/types';

export function getConnectorLoginOutcome(err: unknown): LoginOutcome | undefined {
  if (err instanceof Error && 'loginOutcome' in err) {
    return (err as { loginOutcome?: LoginOutcome }).loginOutcome;
  }
  return undefined;
}

export function buildAlertMessage(
  accountId: string,
  errorType: string,
  loginOutcome?: LoginOutcome
): string {
  if (loginOutcome && !loginOutcome.success) {
    switch (loginOutcome.reason) {
      case 'invalid_credentials':
        return (
          `⚠️ FB account #${accountId}: auto-login failed — credentials rejected. ` +
          `Update \`FB_PASSWORD_${accountId}\` (and \`FB_EMAIL_${accountId}\` if changed).`
        );
      case 'checkpoint':
        return (
          `⚠️ FB account #${accountId}: Facebook checkpoint blocking login. ` +
          `Resolve in a browser, then refresh \`FB_COOKIES_${accountId}\` manually as a one-time recovery.`
        );
      case 'captcha':
        return (
          `⚠️ FB account #${accountId}: auto-login blocked by captcha. ` +
          `Solve manually in a browser to clear, then refresh cookies.`
        );
      case 'two_factor':
        return (
          `⚠️ FB account #${accountId}: Facebook is requiring 2FA. ` +
          `This account is no longer compatible with auto-login.`
        );
      case 'unknown_login_page':
        return (
          `⚠️ FB account #${accountId}: auto-login hit an unknown login page ` +
          `(selectors did not match). Check run logs and update login.ts selectors if Facebook changed layout.`
        );
      case 'timeout':
        return (
          `⚠️ FB account #${accountId}: auto-login timed out. ` +
          `Likely transient — next cron tick will retry.`
        );
      case 'budget_exhausted':
        return (
          `⚠️ FB account #${accountId}: auto-login budget exhausted ` +
          `(3 failed attempts). Backing off 24h. Resolve underlying cause before counter resets.`
        );
    }
  }

  return (
    `⚠️ Facebook account #${accountId} ${errorType === 'banned' ? 'banned/challenged' : 'cookie expired'}.\n\n` +
    `Please refresh cookies in GitHub Secrets (FB_COOKIES_${accountId}).`
  );
}
