import type { Connector } from '@rentifier/connectors';
import { MockConnector, Yad2Connector } from '@rentifier/connectors';
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

export function createDefaultRegistry(env: Env): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register('mock', new MockConnector());

  if (env.ENABLE_YAD2_CONNECTOR === 'true') {
    // Local dev only — GitHub Actions handles yad2 in production
    // to bypass Radware IP block on Cloudflare's AS13335 range.
    registry.register('yad2', new Yad2Connector());
  }

  return registry;
}
