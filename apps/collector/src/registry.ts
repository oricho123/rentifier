import type { Connector, FacebookConfig } from '@rentifier/connectors';
import { MockConnector, Yad2Connector, FacebookConnector } from '@rentifier/connectors';
import type { Env } from './index';

export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(name: string, connector: Connector): void {
    this.connectors.set(name, connector);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  has(name: string): boolean {
    return this.connectors.has(name);
  }
}

function buildFacebookConfig(env: Env): FacebookConfig {
  const cookies: Record<string, string> = {};
  const count = parseInt(env.FB_ACCOUNT_COUNT || '1', 10);
  for (let i = 1; i <= count; i++) {
    const val = (env as unknown as Record<string, string | undefined>)[`FB_COOKIES_${i}`];
    if (val) cookies[String(i)] = val;
  }
  return {
    cookies,
    docId: env.FB_DOC_ID || '',
    fbDtsg: env.FB_DTSG,
    lsd: env.FB_LSD,
  };
}

export function createDefaultRegistry(env: Env): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register('mock', new MockConnector());

  if (env.ENABLE_YAD2_CONNECTOR === 'true') {
    // Local dev only — GitHub Actions handles yad2 in production
    // to bypass Radware IP block on Cloudflare's AS13335 range.
    registry.register('yad2', new Yad2Connector());
  }

  if (env.ENABLE_FACEBOOK_CONNECTOR === 'true') {
    const fbConfig = buildFacebookConfig(env);
    registry.register('facebook', new FacebookConnector(fbConfig));
  }

  return registry;
}
