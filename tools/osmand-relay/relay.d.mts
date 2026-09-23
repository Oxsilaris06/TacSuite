/**
 * Types du relais OsmAnd (relay.mjs), pour le test unitaire TypeScript.
 * Le relais lui-même est du JavaScript Node standard, hors périmètre `tsc`.
 */

export interface RelayPoint {
  ts: number;
  rx: number;
  lat: number;
  lon: number;
  hdop?: number;
  alt?: number;
  speed?: number;
  bearing?: number;
}

export interface RelayTokens {
  readKey: string;
  operators: Record<string, { nom?: string; fonction?: string }>;
}

export interface RelayState {
  tokens: RelayTokens;
  points: Map<string, RelayPoint[]>;
}

export interface Relay {
  server: import('node:http').Server;
  state: RelayState;
  purge: () => void;
  reloadTokens: () => void;
  tokensFile: string;
  base: string;
  allowedOrigins: string[];
  host: string;
  port: number;
  timer?: NodeJS.Timeout;
  watcher?: import('node:fs').FSWatcher | null;
  onSigHup?: () => void;
  close: () => Promise<void>;
}

export interface RelayOptions {
  tokensFile?: string;
  port?: number;
  host?: string;
  ttlH?: number;
  allowedOrigins?: string[];
  base?: string;
  now?: () => number;
  log?: (line: string) => void;
}

export function createRelay(options?: RelayOptions): Relay;
export function startRelay(options?: RelayOptions): Promise<Relay>;
