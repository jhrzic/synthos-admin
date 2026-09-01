/**
 * Server-side SQLite driver interface for Hermes Mission Control
 * Safely initializes better-sqlite3 when available, or provides a structured in-memory fallback
 */
import path from 'path';
import os from 'os';

export const hermesStateDbPath = path.join(os.homedir(), '.hermes', 'state.db');
export const agentLogsDbPath = path.join(os.homedir(), 'jarvis-mission-control', 'agent-logs.db');

export interface HermesDatabaseInstance {
  readonly: boolean;
  path: string;
  query: (sql: string, params?: any[]) => any[];
  prepare: (sql: string) => { all: (params?: any[]) => any[]; get: (params?: any[]) => any };
}

// Fallback in-memory database mock if better-sqlite3 binary is not compiled in sandboxed environment
function createMockDb(dbPath: string): HermesDatabaseInstance {
  return {
    readonly: true,
    path: dbPath,
    query: (_sql: string) => [],
    prepare: (sql: string) => ({
      all: () => [],
      get: () => ({ count: 0, status: 'ok' })
    })
  };
}

let hermesDbInstance: any;
let logsDbInstance: any;

try {
  // Dynamically attempt require of better-sqlite3 in Node.js server environment
  const BetterSqlite3 = require('better-sqlite3');
  hermesDbInstance = new BetterSqlite3(hermesStateDbPath, { readonly: true, fileMustExist: false });
  logsDbInstance = new BetterSqlite3(agentLogsDbPath, { readonly: true, fileMustExist: false });
} catch (e) {
  // Fallback to simulated safe interface
  hermesDbInstance = createMockDb(hermesStateDbPath);
  logsDbInstance = createMockDb(agentLogsDbPath);
}

export const hermesDb = hermesDbInstance;
export const logsDb = logsDbInstance;
