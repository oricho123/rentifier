/**
 * Debug script: test Facebook GraphQL API request with multiple strategies.
 * Usage: npx tsx --env-file=.env scripts/debug-facebook-graphql.ts
 */
import { writeFileSync } from 'fs';

const GROUP_ID = '305724686290054';

const cookies = process.env.FB_COOKIES_1;
const docId = process.env.FB_DOC_ID;
let fbDtsg = process.env.FB_DTSG;
let lsd = process.env.FB_LSD;

if (!cookies || !docId) {
  console.error('Missing required env vars: FB_COOKIES_1, FB_DOC_ID');
  process.exit(1);
}

const cUserMatch = cookies.match(/c_user=(\d+)/);
const cUser = cUserMatch ? cUserMatch[1] : '';

function stripPrefix(text: string): string {
  return text.replace(/^for \(;;\);/, '');
}

/** Compute jazoest checksum from fb_dtsg (required by Facebook CSRF validation) */
function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) {
    sum += dtsg.charCodeAt(i);
  }
  return '2' + sum;
}

/** Fetch a fresh fb_dtsg and lsd from www.facebook.com page source */
async function fetchFreshTokens(): Promise<{ dtsg: string; lsd: string } | null> {
  console.log('\n--- Fetching fresh fb_dtsg from www.facebook.com ---');
  try {
    const response = await fetch('https://www.facebook.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Cookie: cookies!,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = await response.text();
    console.log(`Page status: ${response.status}, length: ${html.length}`);

    // Extract fb_dtsg from page source - multiple patterns
    let dtsg: string | null = null;
    let foundLsd: string | null = null;

    // Pattern 1: DTSGInitData
    const dtsgMatch1 = html.match(/"DTSGInitData".*?"token":"([^"]+)"/);
    if (dtsgMatch1) {
      dtsg = dtsgMatch1[1];
      console.log(`Found fb_dtsg via DTSGInitData: ${dtsg.slice(0, 20)}...`);
    }

    // Pattern 2: dtsg in form input
    if (!dtsg) {
      const dtsgMatch2 = html.match(/name="fb_dtsg" value="([^"]+)"/);
      if (dtsgMatch2) {
        dtsg = dtsgMatch2[1];
        console.log(`Found fb_dtsg via form input: ${dtsg.slice(0, 20)}...`);
      }
    }

    // Pattern 3: DTSG token in script
    if (!dtsg) {
      const dtsgMatch3 = html.match(/"dtsg":\{"token":"([^"]+)"/);
      if (dtsgMatch3) {
        dtsg = dtsgMatch3[1];
        console.log(`Found fb_dtsg via dtsg.token: ${dtsg.slice(0, 20)}...`);
      }
    }

    // Extract LSD
    const lsdMatch = html.match(/"LSD".*?\[.*?"(\w+)"\]/s) || html.match(/name="lsd" value="([^"]+)"/);
    if (lsdMatch) {
      foundLsd = lsdMatch[1];
      console.log(`Found lsd: ${foundLsd.slice(0, 20)}...`);
    }

    if (!dtsg) {
      console.log('Could not extract fb_dtsg from page. Login page?', html.includes('login') ? 'YES' : 'NO');
      writeFileSync('/tmp/fb-homepage.html', html);
      console.log('Page saved to /tmp/fb-homepage.html for inspection');
      return null;
    }

    return { dtsg, lsd: foundLsd || '' };
  } catch (err) {
    console.error('Failed to fetch homepage:', err);
    return null;
  }
}

async function tryRequest(label: string, extraBody: Record<string, string>, extraHeaders: Record<string, string> = {}) {
  const variables = JSON.stringify({
    count: 3,
    feedLocation: 'GROUP',
    feedType: 'DISCUSSION',
    feedbackSource: 0,
    id: GROUP_ID,
    renderLocation: 'group',
    scale: 2,
    sortingSetting: 'TOP_POSTS',
    stream_initial_count: 1,
    useDefaultActor: false,
  });

  const body = new URLSearchParams({
    av: cUser,
    __user: cUser,
    __a: '1',
    __comet_req: '15',
    dpr: '2',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'GroupsCometFeedRegularStoriesPaginationQuery',
    variables,
    doc_id: docId!,
    ...extraBody,
  });

  console.log(`\n--- ${label} ---`);
  console.log(`Body params: ${[...body.keys()].join(', ')}`);

  const response = await fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Cookie: cookies!,
      Origin: 'https://www.facebook.com',
      Referer: `https://www.facebook.com/groups/${GROUP_ID}`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'x-fb-friendly-name': 'GroupsCometFeedRegularStoriesPaginationQuery',
      ...extraHeaders,
    },
    body: body.toString(),
  });

  const text = stripPrefix(await response.text());
  console.log(`Status: ${response.status}, Length: ${text.length}`);

  try {
    const json = JSON.parse(text);
    if (json.error || json.errorSummary) {
      console.log(`Error ${json.error}: ${json.errorDescription || json.errorSummary}`);
      return false;
    }

    const edges = json?.data?.node?.group_feed?.edges;
    if (edges) {
      console.log(`SUCCESS! Found ${edges.length} posts`);
      for (const edge of edges) {
        const node = edge.node;
        const msg = node.comet_sections?.content?.story?.message?.text;
        console.log(`  Post ${node.post_id}: ${(msg || '').slice(0, 80)}...`);
      }
      writeFileSync('/tmp/fb-graphql-success.json', JSON.stringify(json, null, 2));
      return true;
    }

    // Check for multiline NDJSON response (Facebook sometimes returns multiple JSON objects)
    console.log('No edges in parsed JSON. Keys:', Object.keys(json));
    writeFileSync('/tmp/fb-graphql-noedges.json', JSON.stringify(json, null, 2));

    // Try parsing as NDJSON (newline-delimited JSON)
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      console.log(`Response has ${lines.length} JSON lines (NDJSON), checking each...`);
      for (let i = 0; i < lines.length; i++) {
        try {
          const lineJson = JSON.parse(lines[i]);
          const lineEdges = lineJson?.data?.node?.group_feed?.edges;
          if (lineEdges) {
            console.log(`SUCCESS in line ${i}! Found ${lineEdges.length} posts`);
            writeFileSync('/tmp/fb-graphql-success.json', text);
            return true;
          }
        } catch { /* skip unparseable lines */ }
      }
    }

    return false;
  } catch {
    // Could be NDJSON
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      console.log(`Parse error on full text, but ${lines.length} lines found. Trying NDJSON...`);
      for (let i = 0; i < lines.length; i++) {
        try {
          const lineJson = JSON.parse(lines[i]);
          const lineEdges = lineJson?.data?.node?.group_feed?.edges;
          if (lineEdges) {
            console.log(`SUCCESS in NDJSON line ${i}! Found ${lineEdges.length} posts`);
            writeFileSync('/tmp/fb-graphql-success.json', text);
            return true;
          }
          if (lineJson.error) {
            console.log(`Line ${i} error: ${lineJson.error} - ${lineJson.errorDescription || ''}`);
          }
        } catch { /* skip */ }
      }
    }
    console.log('Parse error. Text:', text.slice(0, 300));
    return false;
  }
}

async function main() {
  console.log(`c_user: ${cUser}`);
  console.log(`doc_id: ${docId}`);
  console.log(`fb_dtsg from env: ${fbDtsg ? 'present' : 'MISSING'}`);
  console.log(`lsd from env: ${lsd ? 'present' : 'MISSING'}`);

  // Strategy 1: Use env tokens + jazoest
  if (fbDtsg && lsd) {
    const jazoest = computeJazoest(fbDtsg);
    console.log(`jazoest (computed): ${jazoest}`);
    const ok = await tryRequest('Env fb_dtsg + lsd + jazoest', {
      fb_dtsg: fbDtsg,
      lsd,
      jazoest,
    }, { 'x-fb-lsd': lsd });
    if (ok) return;
  }

  // Strategy 2: Fetch fresh tokens from homepage, then use them
  const freshTokens = await fetchFreshTokens();
  if (freshTokens?.dtsg) {
    fbDtsg = freshTokens.dtsg;
    lsd = freshTokens.lsd || lsd || '';
    const jazoest = computeJazoest(fbDtsg);
    console.log(`Fresh jazoest: ${jazoest}`);

    const ok = await tryRequest('Fresh fb_dtsg + jazoest', {
      fb_dtsg: fbDtsg,
      ...(lsd ? { lsd } : {}),
      jazoest,
    }, lsd ? { 'x-fb-lsd': lsd } : {});
    if (ok) {
      console.log('\n=== UPDATE YOUR .env ===');
      console.log(`FB_DTSG=${fbDtsg}`);
      if (lsd) console.log(`FB_LSD=${lsd}`);
      return;
    }
  }

  // Strategy 3: Env tokens without jazoest (in case it's not needed)
  if (process.env.FB_DTSG && process.env.FB_LSD) {
    const ok = await tryRequest('Env fb_dtsg + lsd (no jazoest)', {
      fb_dtsg: process.env.FB_DTSG,
      lsd: process.env.FB_LSD,
    }, { 'x-fb-lsd': process.env.FB_LSD });
    if (ok) return;
  }

  // Strategy 4: Cookies only (no tokens)
  const ok = await tryRequest('Cookies only (no tokens)', {});
  if (ok) return;

  console.log('\n--- All strategies failed ---');
  console.log('Possible causes:');
  console.log('1. Cookies expired — re-export from Chrome DevTools');
  console.log('2. doc_id changed — re-capture from DevTools Network tab');
  console.log('3. Facebook requires browser-only session context that cannot be replayed');
  console.log('\nTo get fresh values:');
  console.log('  Chrome → DevTools → Network → filter "graphql"');
  console.log('  Copy fb_dtsg, lsd from any request payload');
  console.log('  Copy doc_id from GroupsCometFeedRegularStories request');
}

main().catch(console.error);
