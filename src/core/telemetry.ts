import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EvoKind, SearchHit, TelemetryRecord } from './types.js';
import { EvoStorage } from './storage.js';

export class EvoTelemetry {
  private readonly dbPath: string;
  private readonly storage: EvoStorage;
  private db: DatabaseSync;

  constructor(storage: EvoStorage) {
    this.storage = storage;
    this.storage.ensureInitialized();
    this.dbPath = path.join(this.storage.cacheDir, 'telemetry.db');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        scope_glob TEXT NOT NULL DEFAULT '**/*',
        hit_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        tokens_saved INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS capability_fts USING fts5(
        id UNINDEXED,
        kind UNINDEXED,
        title,
        l0_summary,
        keywords,
        body
      );

      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public syncFromDisk(): void {
    const rules = this.storage.listRules();
    const skills = this.storage.listSkills();
    const tools = this.storage.listTools();

    this.db.exec('DELETE FROM capability_fts;');

    const insertFts = this.db.prepare(
      'INSERT INTO capability_fts (id, kind, title, l0_summary, keywords, body) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const upsertTelemetry = this.db.prepare(`
      INSERT INTO telemetry (id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, tokens_saved, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        l0_summary = excluded.l0_summary,
        scope_glob = excluded.scope_glob
    `);

    const now = new Date().toISOString();

    for (const r of rules) {
      insertFts.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, r.content);
      upsertTelemetry.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, now, r.created_at);
    }

    for (const s of skills) {
      insertFts.run(s.id, 'skill', s.title, s.l0_summary, s.tags.join(' '), `${s.l1_contract}\n${s.l2_sop}`);
      upsertTelemetry.run(s.id, 'skill', s.title, s.l0_summary, '**/*', now, s.created_at);
    }

    for (const t of tools) {
      insertFts.run(t.id, 'tool', t.title, t.l0_summary, t.runtime, JSON.stringify(t.input_schema));
      upsertTelemetry.run(t.id, 'tool', t.title, t.l0_summary, '**/*', now, t.created_at);
    }
  }

  public search(query: string, kind: EvoKind | 'all' = 'all', limit = 10): SearchHit[] {
    this.syncFromDisk();
    const tokens = query
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    let rows: Array<Record<string, unknown>> = [];

    if (tokens.length > 0) {
      const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
      const sql =
        kind === 'all'
          ? `
            SELECT f.id, f.kind, t.title, t.l0_summary, t.scope_glob, t.hit_count, t.success_count, t.fail_count, bm25(capability_fts) as rank
            FROM capability_fts f
            JOIN telemetry t ON f.id = t.id
            WHERE capability_fts MATCH ?
            ORDER BY rank ASC, t.hit_count DESC
            LIMIT ?
          `
          : `
            SELECT f.id, f.kind, t.title, t.l0_summary, t.scope_glob, t.hit_count, t.success_count, t.fail_count, bm25(capability_fts) as rank
            FROM capability_fts f
            JOIN telemetry t ON f.id = t.id
            WHERE capability_fts MATCH ? AND f.kind = ?
            ORDER BY rank ASC, t.hit_count DESC
            LIMIT ?
          `;

      try {
        const stmt = this.db.prepare(sql);
        rows = (kind === 'all' ? stmt.all(ftsQuery, limit) : stmt.all(ftsQuery, kind, limit)) as Array<
          Record<string, unknown>
        >;
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const fallbackSql =
        kind === 'all'
          ? `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, 0.0 as rank FROM telemetry ORDER BY hit_count DESC, created_at DESC LIMIT ?`
          : `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, 0.0 as rank FROM telemetry WHERE kind = ? ORDER BY hit_count DESC, created_at DESC LIMIT ?`;
      const stmt = this.db.prepare(fallbackSql);
      rows = (kind === 'all' ? stmt.all(limit) : stmt.all(kind, limit)) as Array<Record<string, unknown>>;
    }

    return rows.map((r) => {
      const succ = Number(r.success_count || 0);
      const fail = Number(r.fail_count || 0);
      const total = succ + fail;
      const rate = total > 0 ? `${((succ / total) * 100).toFixed(0)}%` : '100% (verified)';
      return {
        id: String(r.id),
        kind: String(r.kind) as EvoKind,
        title: String(r.title),
        l0_summary: String(r.l0_summary),
        scope_glob: String(r.scope_glob || '**/*'),
        hit_count: Number(r.hit_count || 0),
        success_rate: rate,
        score: Math.abs(Number(r.rank || 0)),
      };
    });
  }

  public findSimilarCapabilities(
    title: string,
    l0Summary: string,
    kind: EvoKind,
    excludeId?: string
  ): Array<{ id: string; similarity: number; l0_summary: string }> {
    this.syncFromDisk();
    const existing = this.db
      .prepare('SELECT id, title, l0_summary FROM telemetry WHERE kind = ?')
      .all(kind) as Array<{ id: string; title: string; l0_summary: string }>;

    const targetTokens = tokenizeForSimilarity(`${title} ${l0Summary}`);
    if (targetTokens.size === 0) return [];

    const matches: Array<{ id: string; similarity: number; l0_summary: string }> = [];
    for (const item of existing) {
      if (excludeId && item.id === excludeId) continue;
      const candTokens = tokenizeForSimilarity(`${item.title} ${item.l0_summary}`);
      const sim = jaccardSimilarity(targetTokens, candTokens);
      if (sim > 0) {
        matches.push({ id: item.id, similarity: sim, l0_summary: item.l0_summary });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  public recordUsage(id: string, success: boolean, tokensSavedEstimate = 450): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE telemetry
      SET hit_count = hit_count + 1,
          success_count = success_count + ?,
          fail_count = fail_count + ?,
          tokens_saved = tokens_saved + ?,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(success ? 1 : 0, success ? 0 : 1, tokensSavedEstimate, now, id);
  }

  public getTelemetryMap(): Map<string, TelemetryRecord> {
    this.syncFromDisk();
    const rows = this.db.prepare('SELECT * FROM telemetry').all() as Array<Record<string, unknown>>;
    const map = new Map<string, TelemetryRecord>();
    for (const r of rows) {
      map.set(String(r.id), {
        id: String(r.id),
        kind: String(r.kind) as EvoKind,
        l0_summary: String(r.l0_summary),
        scope_glob: String(r.scope_glob),
        hit_count: Number(r.hit_count || 0),
        success_count: Number(r.success_count || 0),
        fail_count: Number(r.fail_count || 0),
        tokens_saved: Number(r.tokens_saved || 0),
        last_used_at: String(r.last_used_at),
        created_at: String(r.created_at),
      });
    }
    return map;
  }

  public setSessionFlag(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now);
  }

  public getSessionFlag(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM session_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  public close(): void {
    this.db.close();
  }
}

function tokenizeForSimilarity(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]{2,}|[\u4e00-\u9fa5]{1,2}/g) || [];
  const stopWords = new Set(['the', 'and', 'for', 'with', 'when', 'use', 'rule', 'skill', 'tool', 'from', 'that', 'this']);
  return new Set(words.filter((w) => !stopWords.has(w)));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
