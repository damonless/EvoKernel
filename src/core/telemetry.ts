import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EvoKind, SearchHit, TelemetryRecord } from './types.js';
import { EvoStorage } from './storage.js';
import { verifyMemoryFreshness } from './memory.js';

export interface TelemetryOptions {
  forceFts5Fallback?: boolean;
}

export class EvoTelemetry {
  private readonly dbPath: string;
  private readonly storage: EvoStorage;
  private readonly forceFallback: boolean;
  private fts5Enabled = false;
  private db: DatabaseSync;

  constructor(storage: EvoStorage, options?: TelemetryOptions) {
    this.storage = storage;
    this.storage.ensureInitialized();
    this.forceFallback = Boolean(
      options?.forceFts5Fallback || process.env.EVO_FORCE_FTS5_FALLBACK === '1'
    );
    this.dbPath = path.join(this.storage.cacheDir, 'telemetry.db');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  public isFts5Enabled(): boolean {
    return this.fts5Enabled;
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

      CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        created_commit TEXT NOT NULL,
        symptom_text TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        solution_summary TEXT NOT NULL,
        target_symbols TEXT NOT NULL,
        ast_fingerprints TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_fts_fallback (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        keywords TEXT NOT NULL,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    if (this.forceFallback) {
      this.fts5Enabled = false;
      return;
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS capability_fts USING fts5(
          id UNINDEXED,
          kind UNINDEXED,
          title,
          l0_summary,
          keywords,
          body
        );
      `);
      this.db.prepare('SELECT count(*) FROM capability_fts').get();
      this.fts5Enabled = true;
    } catch {
      // Node.js v22.5 ~ v22.14 on Windows compiled node:sqlite without SQLITE_ENABLE_FTS5
      this.fts5Enabled = false;
    }
  }

  public syncFromDisk(): void {
    const rules = this.storage.listRules();
    const skills = this.storage.listSkills();
    const tools = this.storage.listTools();
    const memories = this.storage.listMemories();

    this.db.exec('DELETE FROM capability_fts_fallback;');
    const insertFallback = this.db.prepare(
      'INSERT INTO capability_fts_fallback (id, kind, title, l0_summary, keywords, body) VALUES (?, ?, ?, ?, ?, ?)'
    );

    let insertFts: ReturnType<DatabaseSync['prepare']> | null = null;
    if (this.fts5Enabled) {
      try {
        this.db.exec('DELETE FROM capability_fts;');
        insertFts = this.db.prepare(
          'INSERT INTO capability_fts (id, kind, title, l0_summary, keywords, body) VALUES (?, ?, ?, ?, ?, ?)'
        );
      } catch {
        this.fts5Enabled = false;
        insertFts = null;
      }
    }

    const upsertTelemetry = this.db.prepare(`
      INSERT INTO telemetry (id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, tokens_saved, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        l0_summary = excluded.l0_summary,
        scope_glob = excluded.scope_glob
    `);

    const upsertEpisodic = this.db.prepare(`
      INSERT INTO episodic_memories (
        id, title, l0_summary, created_commit, symptom_text, root_cause, solution_summary,
        target_symbols, ast_fingerprints, hit_count, is_active, last_verified_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        l0_summary = excluded.l0_summary,
        created_commit = excluded.created_commit,
        symptom_text = excluded.symptom_text,
        root_cause = excluded.root_cause,
        solution_summary = excluded.solution_summary,
        target_symbols = excluded.target_symbols,
        ast_fingerprints = excluded.ast_fingerprints
    `);

    const now = new Date().toISOString();

    for (const r of rules) {
      insertFallback.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, r.content);
      insertFts?.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, r.content);
      upsertTelemetry.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, now, r.created_at);
    }

    for (const s of skills) {
      const bodyText = `${s.l1_contract}\n${s.l2_sop}`;
      insertFallback.run(s.id, 'skill', s.title, s.l0_summary, s.tags.join(' '), bodyText);
      insertFts?.run(s.id, 'skill', s.title, s.l0_summary, s.tags.join(' '), bodyText);
      upsertTelemetry.run(s.id, 'skill', s.title, s.l0_summary, '**/*', now, s.created_at);
    }

    for (const t of tools) {
      const schemaText = JSON.stringify(t.input_schema);
      insertFallback.run(t.id, 'tool', t.title, t.l0_summary, t.runtime, schemaText);
      insertFts?.run(t.id, 'tool', t.title, t.l0_summary, t.runtime, schemaText);
      upsertTelemetry.run(t.id, 'tool', t.title, t.l0_summary, '**/*', now, t.created_at);
    }

    for (const m of memories) {
      const keywords = [...m.target_symbols, ...m.tags, m.created_commit].join(' ');
      const bodyText = `${m.symptom}\n${m.root_cause}\n${m.solution}`;
      const scopeDisplay = m.target_symbols.slice(0, 3).join(', ') || '**/*';
      insertFallback.run(m.id, 'memory', m.title, m.l0_summary, keywords, bodyText);
      insertFts?.run(m.id, 'memory', m.title, m.l0_summary, keywords, bodyText);
      upsertTelemetry.run(m.id, 'memory', m.title, m.l0_summary, scopeDisplay, now, m.created_at);
      upsertEpisodic.run(
        m.id,
        m.title,
        m.l0_summary,
        m.created_commit,
        m.symptom,
        m.root_cause,
        m.solution,
        JSON.stringify(m.target_symbols),
        JSON.stringify(m.ast_fingerprints),
        now,
        m.created_at
      );
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
      if (this.fts5Enabled) {
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
          this.fts5Enabled = false;
          rows = [];
        }
      }

      if (!this.fts5Enabled) {
        rows = this.searchFallbackBm25(tokens, kind, limit);
      }
    }

    if (tokens.length === 0) {
      const fallbackSql =
        kind === 'all'
          ? `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, 0.0 as rank FROM telemetry ORDER BY hit_count DESC, created_at DESC LIMIT ?`
          : `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, 0.0 as rank FROM telemetry WHERE kind = ? ORDER BY hit_count DESC, created_at DESC LIMIT ?`;
      const stmt = this.db.prepare(fallbackSql);
      rows = (kind === 'all' ? stmt.all(limit) : stmt.all(kind, limit)) as Array<Record<string, unknown>>;
    }

    const updateActiveStmt = this.db.prepare(
      'UPDATE episodic_memories SET is_active = ?, last_verified_at = ? WHERE id = ?'
    );
    const now = new Date().toISOString();

    const hits: SearchHit[] = rows.map((r) => {
      const id = String(r.id);
      const itemKind = String(r.kind) as EvoKind;
      const succ = Number(r.success_count || 0);
      const fail = Number(r.fail_count || 0);
      const total = succ + fail;
      const rate = total > 0 ? `${((succ / total) * 100).toFixed(0)}%` : '100% (verified)';
      let rawScore = Math.abs(Number(r.rank || 0));
      if (rawScore === 0) rawScore = 1.0;

      if (itemKind === 'memory') {
        const mem = this.storage.getMemory(id);
        if (mem) {
          const ver = verifyMemoryFreshness(this.storage.rootDir, mem, { includeCallers: false });
          const isActive = ver.overall_status === 'VERIFIED' ? 1 : 0;
          updateActiveStmt.run(isActive, now, id);

          if (ver.overall_status === 'VERIFIED') {
            return {
              id,
              kind: itemKind,
              title: String(r.title),
              l0_summary: String(r.l0_summary),
              scope_glob: String(r.scope_glob || '**/*'),
              hit_count: Number(r.hit_count || 0),
              success_rate: rate,
              score: rawScore,
              memory_status: 'VERIFIED',
              memory_badge: `[VERIFIED ${ver.verified_count}/${ver.total_symbols} symbols @ ${ver.current_commit}]`,
            };
          } else {
            const drifted = ver.checks
              .filter((c) => c.status !== 'VERIFIED')
              .map((c) => `${c.symbol}:${c.status}`)
              .join(', ');
            return {
              id,
              kind: itemKind,
              title: String(r.title),
              l0_summary: String(r.l0_summary),
              scope_glob: String(r.scope_glob || '**/*'),
              hit_count: Number(r.hit_count || 0),
              success_rate: 'STALE (needs re-verification)',
              score: rawScore * 0.25, // Demote stale memories in ranking
              memory_status: 'STALE',
              memory_badge: `[STALE: ${drifted || 'symbols drifted'}]`,
            };
          }
        }
      }

      return {
        id,
        kind: itemKind,
        title: String(r.title),
        l0_summary: String(r.l0_summary),
        scope_glob: String(r.scope_glob || '**/*'),
        hit_count: Number(r.hit_count || 0),
        success_rate: rate,
        score: rawScore,
      };
    });

    // Ensure STALE memories are always ranked below active capabilities
    return hits.sort((a, b) => {
      const aStale = a.memory_status === 'STALE' ? 1 : 0;
      const bStale = b.memory_status === 'STALE' ? 1 : 0;
      if (aStale !== bStale) return aStale - bStale;
      return b.score - a.score || b.hit_count - a.hit_count;
    });
  }

  private searchFallbackBm25(
    tokens: string[],
    kind: EvoKind | 'all',
    limit: number
  ): Array<Record<string, unknown>> {
    const sql =
      kind === 'all'
        ? `
          SELECT f.id, f.kind, f.title, f.l0_summary, f.keywords, f.body,
                 t.scope_glob, t.hit_count, t.success_count, t.fail_count
          FROM capability_fts_fallback f
          JOIN telemetry t ON f.id = t.id
        `
        : `
          SELECT f.id, f.kind, f.title, f.l0_summary, f.keywords, f.body,
                 t.scope_glob, t.hit_count, t.success_count, t.fail_count
          FROM capability_fts_fallback f
          JOIN telemetry t ON f.id = t.id
          WHERE f.kind = ?
        `;
    const candidates = (
      kind === 'all' ? this.db.prepare(sql).all() : this.db.prepare(sql).all(kind)
    ) as Array<Record<string, unknown>>;

    const lowerTokens = tokens.map((t) => t.toLowerCase());
    const scored: Array<Record<string, unknown> & { _score: number }> = [];

    for (const row of candidates) {
      const idStr = String(row.id || '').toLowerCase();
      const titleStr = String(row.title || '').toLowerCase();
      const l0Str = String(row.l0_summary || '').toLowerCase();
      const kwStr = String(row.keywords || '').toLowerCase();
      const bodyStr = String(row.body || '').toLowerCase();

      let score = 0;
      for (const tok of lowerTokens) {
        if (idStr.includes(tok)) score += 3.0;
        if (titleStr.includes(tok)) score += 2.5;
        if (kwStr.includes(tok)) score += 2.0;
        if (l0Str.includes(tok)) score += 1.8;
        if (bodyStr.includes(tok)) score += 1.0;
      }

      if (score > 0) {
        scored.push({
          ...row,
          rank: -score,
          _score: score,
        });
      }
    }

    return scored
      .sort((a, b) => b._score - a._score || Number(b.hit_count || 0) - Number(a.hit_count || 0))
      .slice(0, limit);
  }

  public findSimilarCapabilities(
    title: string,
    l0Summary: string,
    kind: EvoKind,
    excludeId?: string,
    extraText = ''
  ): Array<{ id: string; similarity: number; l0_summary: string }> {
    this.syncFromDisk();
    const existing = this.db
      .prepare(
        `SELECT t.id, t.title, t.l0_summary, f.keywords
         FROM telemetry t
         LEFT JOIN capability_fts_fallback f ON t.id = f.id
         WHERE t.kind = ?`
      )
      .all(kind) as Array<{ id: string; title: string; l0_summary: string; keywords?: string }>;

    const targetTokens = tokenizeForSimilarity(`${title} ${l0Summary} ${extraText}`);
    if (targetTokens.size === 0) return [];

    const matches: Array<{ id: string; similarity: number; l0_summary: string }> = [];
    for (const item of existing) {
      if (excludeId && item.id === excludeId) continue;
      const candText =
        kind === 'memory' && extraText
          ? `${item.title} ${item.l0_summary} ${item.keywords || ''}`
          : `${item.title} ${item.l0_summary}`;
      const candTokens = tokenizeForSimilarity(candText);
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
    this.db.prepare('UPDATE episodic_memories SET hit_count = hit_count + 1 WHERE id = ?').run(id);
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
