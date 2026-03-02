/**
 * Debug script: fetch a Facebook group page and dump raw HTML to a file.
 * Usage: npx tsx --env-file=.env scripts/debug-facebook-html.ts
 */
import { writeFileSync } from 'fs';

const MBASIC_BASE_URL = 'https://mbasic.facebook.com';
const GROUP_ID = '305724686290054';

const cookies = process.env.FB_COOKIES_1;
if (!cookies) {
  console.error('FB_COOKIES_1 is not set');
  process.exit(1);
}

async function main() {
  const url = `${MBASIC_BASE_URL}/groups/${GROUP_ID}`;
  console.log(`Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookies,
    },
    redirect: 'manual',
  });

  console.log(`Status: ${response.status}`);
  console.log(`Location: ${response.headers.get('location') || '(none)'}`);

  if (response.status === 302) {
    console.error('Redirected — cookies may be expired');
    const location = response.headers.get('location') || '';
    console.error(`Redirect target: ${location}`);
    return;
  }

  const html = await response.text();
  console.log(`HTML length: ${html.length} chars`);

  // Check for login form
  if (html.includes('id="login_form"') || html.includes('name="login"')) {
    console.error('Login form detected — cookies expired');
  }

  const outPath = '/tmp/fb-debug.html';
  writeFileSync(outPath, html, 'utf-8');
  console.log(`HTML saved to: ${outPath}`);
  console.log('Open in browser or inspect to see the actual DOM structure.');
}

main().catch(console.error);
