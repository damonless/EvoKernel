import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { buildScoreReport, computeGitBugHotspots } from './score.js';
import type { ScoreReport } from './score.js';
import {
  DEFAULT_EVO_CONFIG,
  EvoStorage,
  estimateTokens,
  hasValidEvoStructure,
  openSqliteReadOnly,
  resolveGlobalFallbackDir,
} from '../core/storage.js';
import {
  type RecallWindowStats,
  emptyRecallWindowStats,
  readRecallWindowStatsFromDb,
  redactSensitiveDiagnostics,
} from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { PROFILE_MARKER_START } from '../templates/meta-rule.js';
import { mountIdeExtensions, syncManagedRuleBlocks } from './init.js';
import { formatTerminalOutput, isAsciiMode, isColorEnabled } from './term.js';
import { discoverGlobalProfileTargets } from '../core/profile-sync.js';
import { executeWorkbenchAction, normalizeSymbolForCompare } from '../core/workbench-actions.js';

export { normalizeSymbolForCompare };

export interface UserProfileSnapshot {
  globalRoot: string;
  preferences: any[];
  personalMemories: any[];
  archivedPreferences?: any[];
  totalTokens: number;
  maxTokens: number;
  menuTokens: number;
  maxMenuTokens: number;
  renderedCard: string;
  renderedDirectoryMenu: string;
  syncedHosts: Array<{ id: string; name: string; path: string; detected: boolean; synced: boolean }>;
  history: any[];
}

export interface UiSnapshot {
  score: ScoreReport;
  window7d: RecallWindowStats;
  rules: any[];
  skills: any[];
  tools: any[];
  memories: any[];
  preferences?: any[];
  archived: any[];
  gatekeeperEvents: any[];
  userProfile?: UserProfileSnapshot;
}

function scrubAnonTextValue(val: string, ws: string, relativePathReplacements?: Array<[RegExp, string]>): string {
  let out = val;
  if (ws) {
    const escapedWs = ws
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/(?:\\\\|\\\/)+/g, '[\\\\/]+');
    out = out.replace(new RegExp(`${escapedWs}(?:[\\\\/][^\\s"'<>|]*)?`, 'gi'), '<WORKSPACE>');
  }
  out = out.replace(/(?<![A-Za-z])[A-Za-z]:[\\/]+[^\s"'<>|]*/g, '<PATH>');
  out = out.replace(/\/(?:Users|home|private\/var|var\/folders)\/[^\s"'<>|]*/g, '<HOME>');
  out = redactSensitiveDiagnostics(out, ws);
  out = out.replace(/<HOME>[\\/]+[^\s"'<>|]*/g, '<HOME>');
  out = out.replace(/\b(?:ghp_[A-Za-z0-9_]*|sk-ant-[A-Za-z0-9_-]*|AKIA[0-9A-Z]*)/g, '[REDACTED]');
  if (relativePathReplacements && relativePathReplacements.length > 0) {
    for (const [re, replacement] of relativePathReplacements) {
      out = out.replace(re, replacement);
    }
  }
  return out;
}

function deepScrubAnonObject<T>(
  input: T,
  ws: string,
  relativePathReplacements?: Array<[RegExp, string]>
): T {
  if (typeof input === 'string') {
    return scrubAnonTextValue(input, ws, relativePathReplacements) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => deepScrubAnonObject(item, ws, relativePathReplacements)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deepScrubAnonObject(v, ws, relativePathReplacements);
    }
    return out as T;
  }
  return input;
}

function discoverBundledSeedIds(ws: string): Set<string> {
  const ids = new Set<string>();
  const currentDir =
    (import.meta as { dirname?: string }).dirname || path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(ws, 'templates', 'seed-evo'),
    path.resolve(currentDir, '..', '..', 'templates', 'seed-evo'),
  ];
  const seedDir = candidates.find((dir) => fs.existsSync(dir));
  if (!seedDir) return ids;

  const scanMdDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          ids.add(path.basename(entry.name, '.md'));
        }
      }
    } catch {}
  };
  scanMdDir(path.join(seedDir, 'rules'));
  scanMdDir(path.join(seedDir, 'rules', 'scoped'));

  const skillsDir = path.join(seedDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
          ids.add(entry.name);
        }
      }
    } catch {}
  }

  const toolsDir = path.join(seedDir, 'tools');
  if (fs.existsSync(toolsDir)) {
    try {
      for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          ids.add(entry.name);
        }
      }
    } catch {}
  }

  return ids;
}

export function buildUiSnapshot(
  workspaceRoot: string,
  optionsOrAnon?: boolean | { anon?: boolean; cacheDb?: DatabaseSync }
): UiSnapshot {
  const options = typeof optionsOrAnon === 'boolean' ? { anon: optionsOrAnon } : optionsOrAnon;
  const ws = path.resolve(workspaceRoot);
  const storage = new EvoStorage(ws);
  const dbPath = path.join(storage.cacheDir, 'telemetry.db');
  let db: DatabaseSync | undefined = options?.cacheDb;
  let openedDb = false;

  if (!db && fs.existsSync(dbPath)) {
    try {
      db = openSqliteReadOnly(dbPath);
      openedDb = true;
    } catch {}
  }

  try {
    const score = buildScoreReport(ws, { anon: options?.anon, cacheDb: db });
    const window7d = db ? readRecallWindowStatsFromDb(db, 7) : emptyRecallWindowStats(7);
    const rules: any[] = [];
    const skills: any[] = [];
    const tools: any[] = [];
    const memories: any[] = [];
    const preferences: any[] = [];
    const archived: any[] = [];
    let gatekeeperEvents: any[] = [];
    const telemMap = new Map<string, { hit_count: number; attribution: string }>();

    const anonPathMap = new Map<string, string>();
    const relativePathReplacements: Array<[RegExp, string]> = [];
    const genericBasenames = new Set([
      'index.ts',
      'index.js',
      'main.ts',
      'main.js',
      'run.mjs',
      'types.ts',
      'utils.ts',
      'config.json',
      'package.json',
      'agents.md',
      'claude.md',
      'gemini.md',
      'skill.md',
    ]);
    const resolveAnonModulePath = (rawFilePath: string, fallbackExt = '.ts'): string => {
      const cleanRel = String(rawFilePath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
      if (!cleanRel || /^src\/module-\d+\.[a-z0-9]+$/i.test(cleanRel)) {
        return cleanRel || `src/module-1${fallbackExt}`;
      }
      const key = cleanRel.toLowerCase();
      const existing = anonPathMap.get(key);
      if (existing) return existing;
      const ext = path.extname(cleanRel) || fallbackExt;
      const mapped = `src/module-${anonPathMap.size + 1}${ext}`;
      anonPathMap.set(key, mapped);
      if (cleanRel.includes('/')) {
        const escapedRel = cleanRel
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\//g, '[\\\\/]+');
        relativePathReplacements.push([new RegExp(escapedRel, 'gi'), mapped]);
      }
      const base = path.basename(cleanRel);
      if (
        base.includes('.') &&
        base.length >= 6 &&
        !genericBasenames.has(base.toLowerCase()) &&
        !/^module-\d+\./i.test(base)
      ) {
        const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        relativePathReplacements.push([new RegExp(`\\b${escapedBase}\\b`, 'gi'), mapped]);
      }
      return mapped;
    };

    if (options?.anon) {
      for (const rawHs of computeGitBugHotspots(ws, 10)) {
        resolveAnonModulePath(rawHs.filePath);
      }
    }

    const isSelfEvoRepo =
      fs.existsSync(path.join(ws, 'templates', 'seed-evo')) &&
      fs.existsSync(path.join(ws, 'src', 'core', 'gatekeeper.ts'));
    const bundledSeedIds = discoverBundledSeedIds(ws);
    const cfg = storage.getConfig() as Record<string, unknown>;
    const configExcludeIds = new Set<string>(
      Array.isArray(cfg?.anonExcludeIds) ? cfg.anonExcludeIds.map((x) => String(x)) : []
    );
    const shouldIncludeAnonItem = (
      id: string,
      origin?: string,
      visibility?: string
    ): boolean => {
      if (!options?.anon) return true;
      if (visibility === 'local' || configExcludeIds.has(id)) return false;
      if (isSelfEvoRepo) {
        return (
          origin === 'seed' ||
          origin === 'demo' ||
          visibility === 'public' ||
          bundledSeedIds.has(id)
        );
      }
      return true;
    };

    const hasValidEvo = hasValidEvoStructure(storage.evoDir);
    let rawRules: any[] = [];
    let rawSkills: any[] = [];
    let rawTools: any[] = [];
    let rawMemories: any[] = [];
    let rawPreferences: any[] = [];
    let rawArchived: any[] = [];
    const capMetaMap = new Map<string, { origin?: string; visibility?: string }>();
    const hiddenAnonIds = new Set<string>(configExcludeIds);

    if (hasValidEvo) {
      try {
        rawRules = storage.listRules();
        rawSkills = storage.listSkills();
        rawTools = storage.listTools();
        rawMemories = storage.listMemories();
        rawPreferences = storage.listPreferences();
        rawArchived = storage.listArchivedCapabilities() as any[];
        for (const item of [
          ...rawRules,
          ...rawSkills,
          ...rawTools,
          ...rawMemories,
          ...rawPreferences,
          ...rawArchived,
        ]) {
          const itemId = String(item?.id || '');
          if (!itemId) continue;
          const origin = typeof item.origin === 'string' ? item.origin : undefined;
          const visibility = typeof item.visibility === 'string' ? item.visibility : undefined;
          if (!capMetaMap.has(itemId)) {
            capMetaMap.set(itemId, { origin, visibility });
          }
          if (visibility === 'local' || configExcludeIds.has(itemId)) {
            hiddenAnonIds.add(itemId);
          }
        }
      } catch {}
    }

    if (db) {
      try {
        let rows: any[] = [];
        try {
          rows = db.prepare(
            'SELECT id, hit_count, helped_count, hurt_count, contested_count FROM telemetry'
          ).all() as any[];
        } catch {
          rows = db.prepare(
            'SELECT id, hit_count, helped_count, hurt_count FROM telemetry'
          ).all() as any[];
        }
        for (const r of rows) {
          const h = Number(r.hit_count || 0);
          const helped = Number(r.helped_count || 0);
          const hurt = Number(r.hurt_count || 0);
          const contested = Number(r.contested_count ?? r.contested ?? 0);
          const attr =
            contested > 0 && contested >= helped
              ? 'contested'
              : hurt > helped
                ? 'hurt'
                : helped > 0
                  ? 'helped'
                  : contested > 0
                    ? 'contested'
                    : 'unverified';
          telemMap.set(r.id, { hit_count: h, attribution: attr });
        }
      } catch {}

      try {
        const gRows = db.prepare(
          'SELECT id, timestamp, kind, target_id, target_name, passed, stage_failed, diagnostics FROM gatekeeper_events ORDER BY id DESC LIMIT 200'
        ).all() as any[];
        const anonCapIdMap = new Map<string, string>();
        gatekeeperEvents = gRows
          .filter((r) => {
            if (!options?.anon) return true;
            const targetId = String(r.target_id || '');
            if (hiddenAnonIds.has(targetId)) return false;
            const capMeta = capMetaMap.get(targetId);
            if (capMeta && !shouldIncludeAnonItem(targetId, capMeta.origin, capMeta.visibility)) {
              return false;
            }
            return true;
          })
          .map((r) => {
            const rawTargetId = String(r.target_id || '');
            const rawKind =
              String(r.kind || 'cap')
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '') || 'cap';
            const capMeta = capMetaMap.get(rawTargetId);
            let safeTargetId = r.target_id;
            if (
              options?.anon &&
              isSelfEvoRepo &&
              !bundledSeedIds.has(rawTargetId) &&
              capMeta?.origin !== 'seed' &&
              capMeta?.origin !== 'demo' &&
              capMeta?.visibility !== 'public'
            ) {
              const mapKey = `${rawKind}:${rawTargetId}`;
              let mappedId = anonCapIdMap.get(mapKey);
              if (!mappedId) {
                mappedId = `sanitized-${rawKind}-${anonCapIdMap.size + 1}`;
                anonCapIdMap.set(mapKey, mappedId);
              }
              safeTargetId = mappedId;
            }
            return {
              ...r,
              target_id: safeTargetId,
              target_name: options?.anon
                ? scrubAnonTextValue(r.target_name || '', ws)
                : r.target_name,
              passed: r.passed === 1,
              diagnostics: options?.anon
                ? scrubAnonTextValue(r.diagnostics || '', ws)
                : redactSensitiveDiagnostics(r.diagnostics || '', ws),
            };
          });
      } catch {}
    }

    const attach = (item: any) => {
      const t = telemMap.get(item.id) || { hit_count: 0, attribution: 'unverified' };
      return { ...item, hit_count: t.hit_count, attribution: t.attribution };
    };

    if (hasValidEvo) {
      try {
        const filterAnon = <
          T extends { id: string; origin?: string; visibility?: string },
        >(
          items: T[]
        ): T[] =>
          options?.anon
            ? items.filter((item) => shouldIncludeAnonItem(item.id, item.origin, item.visibility))
            : items;
        const scrubAnonText = (val: unknown) =>
          options?.anon && typeof val === 'string' ? scrubAnonTextValue(val, ws) : val;
        rules.push(
          ...filterAnon(rawRules).map((rule) => {
            const attached = attach(rule);
            if (options?.anon) {
              attached.title = scrubAnonText(attached.title);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.content = scrubAnonText(attached.content);
              if (typeof attached.contrastive_evidence === 'string') {
                attached.contrastive_evidence = scrubAnonText(attached.contrastive_evidence);
              }
              if (Array.isArray(attached.transfer_scenarios)) {
                attached.transfer_scenarios = attached.transfer_scenarios.map((s: string) =>
                  scrubAnonText(s)
                );
              }
            }
            return attached;
          })
        );
        skills.push(
          ...filterAnon(rawSkills).map((skill) => {
            const attached = attach(skill);
            if (options?.anon) {
              attached.name = scrubAnonText(attached.name);
              attached.title = scrubAnonText(attached.title);
              attached.description = scrubAnonText(attached.description);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.l1_contract = scrubAnonText(attached.l1_contract);
              attached.l2_sop = scrubAnonText(attached.l2_sop);
              if (typeof attached.trigger_cue === 'string') {
                attached.trigger_cue = scrubAnonText(attached.trigger_cue);
              }
              if (typeof attached.contrastive_evidence === 'string') {
                attached.contrastive_evidence = scrubAnonText(attached.contrastive_evidence);
              }
            }
            return attached;
          })
        );
        tools.push(
          ...filterAnon(rawTools).map((tool) => {
            const attached = attach(tool);
            if (options?.anon) {
              attached.title = scrubAnonText(attached.title);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.script_code = scrubAnonText(attached.script_code);
              if (typeof attached.script_path === 'string') {
                const rel = path.relative(ws, attached.script_path).replace(/\\/g, '/');
                attached.script_path = rel.startsWith('..')
                  ? path.basename(attached.script_path)
                  : rel;
              }
            }
            return attached;
          })
        );
        for (const m of filterAnon(rawMemories)) {
          const v = verifyMemoryFreshness(ws, m, { includeCallers: true, cacheDb: db });
          const callers = Array.from(new Set((v.topology_anchors || []).flatMap((a: any) => a.callers || [])));
          const attached = attach({ ...m, freshness: { ...v, callers } });
          if (options?.anon) {
            if (Array.isArray(attached.target_symbols)) {
              attached.target_symbols = attached.target_symbols.map((sym: string) => {
                const parts = String(sym).split('#');
                const ext = path.extname(parts[0] || '') || '.ts';
                const safeFile = resolveAnonModulePath(parts[0] || '', ext);
                return parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
              });
            }
            if (attached.ast_fingerprints && typeof attached.ast_fingerprints === 'object') {
              const sanitizedFps: Record<string, any> = {};
              for (const [fpKey, fpVal] of Object.entries(attached.ast_fingerprints as Record<string, any>)) {
                const parts = String(fpKey).split('#');
                const rawFpFile = parts[0] || fpVal?.file_path || fpVal?.file || '';
                const ext = path.extname(rawFpFile) || '.ts';
                const newFile = resolveAnonModulePath(rawFpFile, ext);
                const newKey = parts[1] ? `${newFile}#${parts[1]}` : newFile;
                sanitizedFps[newKey] = {
                  ...(fpVal || {}),
                  file_path: newFile,
                  file: undefined,
                };
              }
              attached.ast_fingerprints = sanitizedFps;
            }
            if (attached.freshness && typeof attached.freshness === 'object') {
              if (Array.isArray(attached.freshness.checks)) {
                attached.freshness.checks = attached.freshness.checks.map(
                  (chk: any) => {
                    const rawSym = String(chk?.symbol || '');
                    const parts = rawSym.split('#');
                    const rawFile = parts[0] || chk?.recorded?.file_path || '';
                    const ext = path.extname(rawFile) || '.ts';
                    const safeFile = resolveAnonModulePath(rawFile, ext);
                    const safeSym = parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
                    return {
                      ...chk,
                      symbol: safeSym,
                      detail:
                        typeof chk?.detail === 'string'
                          ? scrubAnonTextValue(chk.detail, ws, relativePathReplacements).replace(
                              /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                              safeFile
                            )
                          : chk?.detail,
                      recorded: chk?.recorded
                        ? {
                            ...chk.recorded,
                            file_path: safeFile,
                            file: undefined,
                            symbol: parts[1] || safeFile,
                            signature:
                              typeof chk.recorded.signature === 'string'
                                ? chk.recorded.signature.includes('#')
                                  ? safeSym
                                  : scrubAnonTextValue(chk.recorded.signature, ws, relativePathReplacements).replace(
                                      /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                                      safeFile
                                    )
                                : chk.recorded.signature,
                          }
                        : chk?.recorded,
                      current: chk?.current
                        ? {
                            ...chk.current,
                            file_path: safeFile,
                            file: undefined,
                            symbol: parts[1] || safeFile,
                            signature:
                              typeof chk.current.signature === 'string'
                                ? chk.current.signature.includes('#')
                                  ? safeSym
                                  : scrubAnonTextValue(chk.current.signature, ws, relativePathReplacements).replace(
                                      /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                                      safeFile
                                    )
                                : chk.current.signature,
                          }
                        : chk?.current,
                    };
                  }
                );
              }
              if (Array.isArray(attached.freshness.callers)) {
                attached.freshness.callers = attached.freshness.callers.map(
                  (_c: string, cIdx: number) => `src/caller-${cIdx + 1}.ts:10`
                );
              }
              if (Array.isArray(attached.freshness.topology_anchors)) {
                attached.freshness.topology_anchors = attached.freshness.topology_anchors.map(
                  (a: any) => {
                    const rawSym = String(a?.symbol || '');
                    const parts = rawSym.split('#');
                    const rawAnchorFile = a?.file_path || parts[0] || '';
                    const safeFile = resolveAnonModulePath(rawAnchorFile, path.extname(rawAnchorFile) || '.ts');
                    const safeSym = parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
                    return {
                      ...a,
                      symbol: safeSym,
                      file_path: safeFile,
                      codegraph_hint: `view_file ${safeFile} (lines ${a?.lines || '1-1'})`,
                      callers: Array.isArray(a?.callers)
                        ? a.callers.map((_c: string, cIdx: number) => `src/caller-${cIdx + 1}.ts:10`)
                        : [],
                    };
                  }
                );
              }
            }
            attached.title = scrubAnonTextValue(String(attached.title || ''), ws, relativePathReplacements);
            attached.l0_summary = scrubAnonTextValue(String(attached.l0_summary || ''), ws, relativePathReplacements);
            attached.symptom = scrubAnonTextValue(String(attached.symptom || ''), ws, relativePathReplacements);
            attached.root_cause = scrubAnonTextValue(String(attached.root_cause || ''), ws, relativePathReplacements);
            attached.solution = scrubAnonTextValue(String(attached.solution || ''), ws, relativePathReplacements);
          }
          memories.push(attached);
        }
        preferences.push(
          ...filterAnon(rawPreferences).map((pref) => {
            const attached = attach(pref);
            attached.tier = path.resolve(ws).toLowerCase() === path.resolve(resolveGlobalFallbackDir()).toLowerCase() ? 'GLOBAL' : 'LOCAL';
            if (options?.anon) {
              attached.title = scrubAnonText(attached.title);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.content = scrubAnonText(attached.content);
            }
            return attached;
          })
        );
        archived.push(
          ...filterAnon(rawArchived).map((item) => {
            const mapped = {
              ...item,
              tier: path.resolve(ws).toLowerCase() === path.resolve(resolveGlobalFallbackDir()).toLowerCase() ? 'GLOBAL' : 'LOCAL',
            };
            if (!options?.anon) return mapped;
            return {
              ...mapped,
              title: scrubAnonText(item.title),
              l0_summary: scrubAnonText(item.l0_summary),
              archive_reason: scrubAnonText(item.archive_reason),
            };
          })
        );
      } catch {}
    }

    const globalRoot = resolveGlobalFallbackDir();
    const isSameAsGlobal = path.resolve(ws).toLowerCase() === path.resolve(globalRoot).toLowerCase();
    const skipHostGlobalForAnon = Boolean(options?.anon) && !process.env.EVO_GLOBAL_DIR && !isSameAsGlobal;

    const HOST_DISPLAY_NAMES: Record<string, string> = {
      gemini: 'Gemini CLI',
      claude: 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      windsurf: 'Windsurf',
      cline: 'Cline',
      roo: 'Roo Code',
      opencode: 'OpenCode',
      isolated: 'USER_PROFILE.md',
      custom: 'Custom Target',
    };

    const probeSyncedHosts = (gRoot: string): Array<{ id: string; name: string; path: string; detected: boolean; synced: boolean }> => {
      if (skipHostGlobalForAnon) return [];
      const discovered = discoverGlobalProfileTargets(gRoot);
      const targets = [...discovered];
      const digestTargetPath = path.join(gRoot, 'USER_PROFILE.md');
      if (
        !process.env.EVO_GLOBAL_PROFILE_TARGETS?.trim() &&
        fs.existsSync(digestTargetPath) &&
        !targets.some((t) => path.resolve(t.path).toLowerCase() === path.resolve(digestTargetPath).toLowerCase())
      ) {
        targets.push({ host: 'isolated', path: digestTargetPath });
      }
      const out: Array<{ id: string; name: string; path: string; detected: boolean; synced: boolean }> = [];
      for (const target of targets) {
        let synced = false;
        if (fs.existsSync(target.path)) {
          try {
            const txt = fs.readFileSync(target.path, 'utf8');
            synced = txt.includes(PROFILE_MARKER_START) || txt.includes('Auto-Managed by EvoKernel');
          } catch {}
        }
        out.push({
          id: target.host,
          name: HOST_DISPLAY_NAMES[target.host] || path.basename(target.path),
          path: options?.anon ? `~/${path.basename(target.path)}` : target.path,
          detected: true,
          synced,
        });
      }
      return out;
    };

    let userProfile: UserProfileSnapshot;
    if (skipHostGlobalForAnon) {
      userProfile = {
        globalRoot: '~/.evo/global',
        preferences: [],
        personalMemories: [],
        archivedPreferences: [],
        totalTokens: 0,
        maxTokens: DEFAULT_EVO_CONFIG.maxGlobalProfileTokens ?? 800,
        menuTokens: 0,
        maxMenuTokens: DEFAULT_EVO_CONFIG.maxDirectoryMenuTokens ?? 250,
        renderedCard: '',
        renderedDirectoryMenu: '',
        syncedHosts: [],
        history: [],
      };
    } else {
      const globalStorage = isSameAsGlobal ? storage : new EvoStorage(globalRoot);
      const hasGlobalEvo = isSameAsGlobal ? hasValidEvo : hasValidEvoStructure(globalStorage.evoDir);
      const globalCfg = hasGlobalEvo ? globalStorage.getConfig() : { ...DEFAULT_EVO_CONFIG };
      const globalTelemMap = new Map<string, { hit_count: number; attribution: string }>();
      let globalDb: DatabaseSync | undefined;
      let openedGlobalDb = false;

      if (isSameAsGlobal) {
        for (const [k, v] of telemMap.entries()) globalTelemMap.set(k, v);
      } else if (hasGlobalEvo && fs.existsSync(globalStorage.telemetryDbPath)) {
        try {
          globalDb = openSqliteReadOnly(globalStorage.telemetryDbPath);
          openedGlobalDb = true;
          let gRows: any[] = [];
          try {
            gRows = globalDb.prepare('SELECT id, hit_count, helped_count, hurt_count, contested_count FROM telemetry').all() as any[];
          } catch {
            gRows = globalDb.prepare('SELECT id, hit_count, helped_count, hurt_count FROM telemetry').all() as any[];
          }
          for (const r of gRows) {
            const h = Number(r.hit_count || 0);
            const helped = Number(r.helped_count || 0);
            const hurt = Number(r.hurt_count || 0);
            const contested = Number(r.contested_count ?? r.contested ?? 0);
            const attr = contested > 0 && contested >= helped ? 'contested' : hurt > helped ? 'hurt' : helped > 0 ? 'helped' : contested > 0 ? 'contested' : 'unverified';
            globalTelemMap.set(r.id, { hit_count: h, attribution: attr });
          }
        } catch {}
      }

      try {
        const filterAnonItem = <T extends { id: string; origin?: string; visibility?: string }>(items: T[]): T[] =>
          options?.anon
            ? items.filter((item) => shouldIncludeAnonItem(item.id, item.origin, item.visibility))
            : items;
        const scrubField = (val: unknown) =>
          options?.anon && typeof val === 'string' ? scrubAnonTextValue(val, ws, relativePathReplacements) : val;

        let globalPrefs: any[] = [];
        let globalSkills: any[] = [];
        let globalMemories: any[] = [];
        let globalArchivedPrefs: any[] = [];

        if (isSameAsGlobal) {
          globalPrefs = preferences.map((p) => ({ ...p, tier: 'GLOBAL', scope: 'global' }));
          globalSkills = skills.filter((s) => s.enabled !== false);
          globalMemories = memories.map((m) => ({ ...m, tier: 'GLOBAL' }));
          globalArchivedPrefs = archived
            .filter((a) => a.kind === 'preference')
            .map((a) => ({ ...a, tier: 'GLOBAL' }));
        } else if (hasGlobalEvo) {
          globalPrefs = filterAnonItem(globalStorage.listPreferences()).map((pref) => {
            const gt = globalTelemMap.get(pref.id) || { hit_count: 0, attribution: 'unverified' };
            const item: any = {
              ...pref,
              hit_count: gt.hit_count,
              attribution: gt.attribution,
              tier: 'GLOBAL',
              scope: 'global',
            };
            if (options?.anon) {
              item.title = scrubField(item.title);
              item.l0_summary = scrubField(item.l0_summary);
              item.content = scrubField(item.content);
            }
            return item;
          });
          globalSkills = filterAnonItem(globalStorage.listSkills()).filter((s) => s.enabled !== false);
          globalMemories = filterAnonItem(globalStorage.listMemories()).map((m) => {
            const gt = globalTelemMap.get(m.id) || { hit_count: 0, attribution: 'unverified' };
            return {
              ...m,
              hit_count: gt.hit_count,
              attribution: gt.attribution,
              tier: 'GLOBAL',
            };
          });
          globalArchivedPrefs = filterAnonItem(
            globalStorage.listArchivedCapabilities().filter((a) => a.kind === 'preference') as any[]
          ).map((a) => ({
            ...a,
            tier: 'GLOBAL',
            title: options?.anon ? scrubField(a.title) : a.title,
            l0_summary: options?.anon ? scrubField(a.l0_summary) : a.l0_summary,
          }));

          const existingPrefIds = new Set(preferences.map((p) => p.id));
          for (const gp of globalPrefs) {
            if (!existingPrefIds.has(gp.id)) {
              preferences.push(gp);
              existingPrefIds.add(gp.id);
            }
          }
          const existingArcKeys = new Set(archived.map((a) => `${a.kind}:${a.id}`));
          for (const ga of globalArchivedPrefs) {
            if (!existingArcKeys.has(`${ga.kind}:${ga.id}`)) {
              archived.push(ga);
              existingArcKeys.add(`${ga.kind}:${ga.id}`);
            }
          }
        }

        const localPersonalMems = isSameAsGlobal
          ? []
          : memories
              .filter(
                (m) =>
                  m.memory_type === 'personal' ||
                  (Array.isArray(m.tags) &&
                    m.tags.some((t: string) => ['personal', 'preference', 'workflow'].includes(String(t).toLowerCase()))) ||
                  !Array.isArray(m.target_symbols) ||
                  m.target_symbols.length === 0
              )
              .map((m) => ({ ...m, tier: 'LOCAL' }));
        const seenPersonalMemIds = new Set(globalMemories.map((m) => m.id));
        const personalMemories = [
          ...globalMemories,
          ...localPersonalMems.filter((m) => !seenPersonalMemIds.has(m.id)),
        ];

        const maxTokens = globalCfg.maxGlobalProfileTokens ?? 800;
        const maxMenuTokens =
          (globalCfg as any).maxDirectoryMenuTokens ??
          (globalCfg as any).maxProfileMenuTokens ??
          250;
        const renderedDirectoryMenu = hasGlobalEvo
          ? globalStorage.formatTaskDirectoryMenu(maxMenuTokens)
          : '';
        const renderedCard = hasGlobalEvo ? globalStorage.formatUserProfileDigest() : '';
        const totalTokens = hasGlobalEvo ? globalStorage.getProfileTokenUsage().totalTokens : 0;
        const menuTokens = estimateTokens(renderedDirectoryMenu);
        const syncedHosts = probeSyncedHosts(globalRoot);

        let history: any[] = [];
        const rawHistoryFn = (globalStorage as any).listProfileHistory;
        if (hasGlobalEvo && typeof rawHistoryFn === 'function') {
          try {
            history = (rawHistoryFn.call(globalStorage, 20) || []).map((entry: any) => ({
              ...entry,
              timestamp: entry.ts || entry.timestamp || '',
              undoable: entry.action !== 'undo',
            }));
          } catch {
            history = [];
          }
        }
        if (history.length === 0) {
          const synth = [
            ...globalPrefs.map((p) => ({
              id: p.id,
              kind: 'preference',
              action: p.enabled === false ? 'paused' : 'saved',
              title: p.title || p.id,
              timestamp: p.updated_at || p.created_at,
              tier: 'GLOBAL',
              undoable: false,
            })),
            ...globalArchivedPrefs.map((a) => ({
              id: a.id,
              kind: 'preference',
              action: 'archived',
              title: a.title || a.id,
              timestamp: a.archived_at,
              tier: 'GLOBAL',
              undoable: false,
            })),
          ];
          synth.sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0));
          history = synth.slice(0, 10);
        }

        userProfile = {
          globalRoot: options?.anon ? '~/.evo/global' : globalRoot,
          preferences: globalPrefs,
          personalMemories,
          archivedPreferences: globalArchivedPrefs,
          totalTokens,
          maxTokens,
          menuTokens,
          maxMenuTokens,
          renderedCard,
          renderedDirectoryMenu,
          syncedHosts,
          history,
        };
      } finally {
        if (openedGlobalDb && globalDb) {
          try { globalDb.close(); } catch {}
        }
      }
    }

    const rawSnapshot: UiSnapshot = {
      score,
      window7d,
      rules,
      skills,
      tools,
      memories,
      preferences,
      archived,
      gatekeeperEvents,
      userProfile,
    };
    return options?.anon ? deepScrubAnonObject(rawSnapshot, ws, relativePathReplacements) : rawSnapshot;
  } finally {
    if (openedDb && db) {
      try { db.close(); } catch {}
    }
  }
}

export interface UiServerOptions {
  port?: number;
  token?: string;
  anon?: boolean;
}

export interface UiServerInstance {
  port: number;
  token: string;
  url: string;
  server: http.Server;
  close: () => Promise<void>;
}

export const MAX_ACTION_BODY_BYTES = 1024 * 1024; // 1MB limit

export function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

export function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_ACTION_BODY_BYTES
): Promise<{ ok: true; body: any } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    const onData = (chunk: Buffer) => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        settled = true;
        cleanup();
        req.pause();
        resolve({
          ok: false,
          status: 413,
          error: `Payload Too Large: Request body exceeds ${maxBytes} byte limit`,
        });
      } else {
        chunks.push(chunk);
      }
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({ ok: false, status: 400, error: 'Bad Request: Empty request body' });
        return;
      }
      try {
        const body = JSON.parse(raw);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          resolve({ ok: false, status: 400, error: 'Bad Request: Body must be a JSON object' });
          return;
        }
        resolve({ ok: true, body });
      } catch (err: any) {
        resolve({ ok: false, status: 400, error: `Bad Request: Malformed JSON (${err?.message || 'syntax error'})` });
      }
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, status: 400, error: `Bad Request: Stream error (${err.message})` });
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, status: 400, error: 'Bad Request: Connection closed prematurely' });
    };

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

function findBinaryInPath(binaryName: string): string | null {
  const envPath = process.env.PATH || '';
  const dirs = envPath.split(path.delimiter);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ? process.env.PATHEXT.split(';') : ['.EXE', '.CMD', '.BAT']).map((e) => e.toLowerCase())
    : [''];

  for (const dir of dirs) {
    if (!dir.trim()) continue;
    for (const ext of exts) {
      const candidate = binaryName.toLowerCase().endsWith(ext.toLowerCase()) ? binaryName : `${binaryName}${ext}`;
      const full = path.join(dir, candidate);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return full;
        }
      } catch {}
    }
  }
  return null;
}

export function findEditorExecutable(editorName: string): string | null {
  const pathEnv = process.env.PATH || '';
  const isWindows = process.platform === 'win32';
  const delimiter = path.delimiter;
  const exts = isWindows
    ? (process.env.PATHEXT ? process.env.PATHEXT.split(';') : ['.EXE', '.CMD', '.BAT']).map((e) => e.toLowerCase())
    : [''];
  const dirs = pathEnv.split(delimiter);

  for (const dir of dirs) {
    if (!dir) continue;
    if (isWindows) {
      for (const ext of exts) {
        const full = path.join(dir, editorName + ext);
        try {
          if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
        } catch {}
      }
    } else {
      const full = path.join(dir, editorName);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

export function isTestEnvironment(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT || process.env.EVO_TEST_MODE);
}

export function launchEditorAtLocation(filePath: string, line: number): { launched: boolean; editor?: string } {
  const targetArg = `${filePath}:${line}`;
  const candidates = ['cursor', 'code', 'windsurf'];

  for (const name of candidates) {
    const execPath = findEditorExecutable(name);
    if (execPath) {
      if (isTestEnvironment()) {
        return { launched: false, editor: name };
      }
      try {
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(execPath)) {
          spawn('cmd.exe', ['/c', execPath, '--goto', targetArg], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } else {
          spawn(execPath, ['--goto', targetArg], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        }
        return { launched: true, editor: name };
      } catch {}
    }
  }

  if (isTestEnvironment()) {
    return { launched: false, editor: 'test-noop' };
  }

  // Fallback to platform system opener if no IDE CLI detected
  try {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${JSON.stringify(filePath)}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    }
    return { launched: true, editor: 'system-default' };
  } catch {
    return { launched: false };
  }
}

export function detectChromiumBrowser(): string | null {
  const platform = process.platform;

  if (platform === 'win32') {
    const progFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const localAppData = process.env.LOCALAPPDATA || '';

    const candidates = [
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      localAppData ? path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : '',
    ].filter(Boolean);

    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {}
    }

    return findBinaryInPath('msedge.exe') || findBinaryInPath('chrome.exe') || findBinaryInPath('brave.exe');
  }

  if (platform === 'darwin') {
    const home = os.homedir();
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(home, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    ];
    for (const c of macCandidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {}
    }
    return findBinaryInPath('google-chrome') || findBinaryInPath('microsoft-edge') || findBinaryInPath('chromium');
  }

  // Linux / other Unix
  const linuxCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ];
  for (const c of linuxCandidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return (
    findBinaryInPath('google-chrome-stable') ||
    findBinaryInPath('google-chrome') ||
    findBinaryInPath('microsoft-edge-stable') ||
    findBinaryInPath('microsoft-edge') ||
    findBinaryInPath('chromium') ||
    findBinaryInPath('chromium-browser')
  );
}

/**
 * Strict local HTTP loopback URL validator.
 * Validates protocol, hostname, absence of userinfo (@ spoofing defense),
 * and valid numeric port range [0, 65535].
 */
export function isValidLocalHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false;
    if (u.username || u.password) return false;
    const port = parseInt(u.port, 10);
    return Number.isFinite(port) && port >= 0 && port <= 65535;
  } catch {
    return false;
  }
}

export function launchDefaultBrowser(url: string): boolean {
  if (!isValidLocalHttpUrl(url)) {
    return false;
  }
  if (isTestEnvironment()) {
    return true;
  }
  try {
    if (process.platform === 'win32') {
      const escapedUrl = url.replace(/'/g, "''");
      const psCommand = `Start-Process -FilePath '${escapedUrl}'`;
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export interface DesktopWindowOptions {
  windowSize?: string;
  fallbackToDefault?: boolean;
}

export function launchNativeDesktopWindow(
  url: string,
  options: DesktopWindowOptions = {}
): boolean {
  if (!isValidLocalHttpUrl(url)) {
    return false;
  }
  if (isTestEnvironment()) {
    return true;
  }

  const fallback = options.fallbackToDefault !== false;
  const windowSize = options.windowSize || '1440,900';
  const browserPath = detectChromiumBrowser();

  if (!browserPath) {
    if (fallback) {
      return launchDefaultBrowser(url);
    }
    return false;
  }

  try {
    const child = spawn(browserPath, [`--app=${url}`, `--window-size=${windowSize}`], {
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', () => {
      if (fallback) {
        launchDefaultBrowser(url);
      }
    });

    child.unref();
    return true;
  } catch {
    if (fallback) {
      return launchDefaultBrowser(url);
    }
    return false;
  }
}

export async function startUiServer(
  workspaceRoot: string,
  options: UiServerOptions = {}
): Promise<UiServerInstance> {
  if (
    options.port !== undefined &&
    (!Number.isFinite(options.port) || options.port < 0 || options.port > 65535)
  ) {
    throw new RangeError(`options.port must be an integer between 0 and 65535 (received ${options.port})`);
  }
  const resolved = path.resolve(workspaceRoot);
  const ws = fs.existsSync(resolved)
    ? (fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved))
    : resolved;
  const token =
    options.token && options.token.trim()
      ? options.token.trim()
      : crypto.randomBytes(16).toString('hex');
  const clients = new Set<http.ServerResponse>();
  let snapshot = buildUiSnapshot(ws, { anon: options.anon });

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = (req.headers.host || '').toLowerCase();
      const hostname = hostHeader.split(':')[0];
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Invalid Host header');
        return;
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Cross-site requests blocked');
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://${hostHeader || '127.0.0.1'}`);
      const pathname = reqUrl.pathname;
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderUiClientHtml(snapshot, { token, anon: options.anon }));
        return;
      }
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      const headerToken = req.headers['x-evo-ui-token'];
      const queryToken = reqUrl.searchParams.get('token');
      if (headerToken !== token && queryToken !== token) {
        sendJsonResponse(res, 401, { ok: false, error: 'Unauthorized: Valid X-Evo-UI-Token required' });
        return;
      }

      if (pathname === '/api/snapshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshot));
        return;
      }
      if (pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (pathname === '/api/export') {
        const exportHtml = buildExportHtmlContent(ws, { anon: options.anon });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'attachment; filename="evo-workbench-export.html"',
        });
        res.end(exportHtml);
        return;
      }

      // --- POST /api/action Router ---
      if (pathname === '/api/action') {
        if (req.method !== 'POST') {
          sendJsonResponse(res, 405, { ok: false, error: 'Method Not Allowed: Expected POST' }, { Allow: 'POST' });
          return;
        }

        const rawContentType = (req.headers['content-type'] || '').trim();
        const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
        if (mimeType !== 'application/json') {
          sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Content-Type must be application/json' });
          return;
        }

        const bodyResult = await readJsonBody(req);
        if (!bodyResult.ok) {
          sendJsonResponse(
            res,
            bodyResult.status,
            { ok: false, error: bodyResult.error },
            bodyResult.status === 413 ? { Connection: 'close' } : {}
          );
          return;
        }

        const body = bodyResult.body;
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) {
          sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing or invalid action' });
          return;
        }

        const params = (body.params && typeof body.params === 'object' && !Array.isArray(body.params))
          ? body.params
          : body;

        // Delegate unified action execution (including default archive reason "Archived via EvoKernel Workbench")
        const actionResult = await executeWorkbenchAction(ws, action, params, {
          buildSnapshot: (targetWs, opts) => buildUiSnapshot(targetWs, opts),
          anon: options.anon,
          notifyChange,
          openEditor: (targetPath, lineNum) => {
            const { launched, editor } = launchEditorAtLocation(targetPath, lineNum);
            return { opened: targetPath, line: lineNum, editor, launched };
          },
          syncRuleBlocks: syncManagedRuleBlocks,
        });
        if (actionResult.body.snapshot) {
          snapshot = actionResult.body.snapshot;
        }
        sendJsonResponse(res, actionResult.status, actionResult.body);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err: any) {
      sendJsonResponse(res, 500, { ok: false, error: `Internal Server Error: ${err?.message || 'unknown error'}` });
    }
  });

  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  function notifyChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        snapshot = buildUiSnapshot(ws, { anon: options.anon });
        const payload = `data: ${JSON.stringify({ type: 'change', timestamp: Date.now() })}\n\n`;
        for (const c of clients) { try { c.write(payload); } catch {} }
      } catch {}
    }, 300);
  }

  const evoDir = path.join(ws, '.evo');
  if (fs.existsSync(evoDir)) {
    try {
      const w = fs.watch(evoDir, { recursive: true }, (_e, f) => {
        if (!f) return notifyChange();
        const norm = f.replace(/\\/g, '/');
        if (norm.startsWith('.cache') || norm.includes('telemetry.db')) return;
        notifyChange();
      });
      w.on('error', () => {}); watchers.push(w);
    } catch {}
  }
  const gitHead = path.join(ws, '.git', 'HEAD');
  if (fs.existsSync(gitHead)) {
    try { const w = fs.watch(gitHead, () => notifyChange()); w.on('error', () => {}); watchers.push(w); } catch {}
  }
  const watchedFiles = new Set<string>();
  for (const m of snapshot.memories || []) {
    for (const d of Object.values(m.ast_fingerprints || {}) as any[]) {
      const rel = d?.file_path || d?.file;
      if (rel) {
        const full = path.resolve(ws, rel);
        if (fs.existsSync(full) && !watchedFiles.has(full)) {
          watchedFiles.add(full);
          try { const w = fs.watch(full, () => notifyChange()); w.on('error', () => {}); watchers.push(w); } catch {}
        }
      }
    }
  }

  const startPort = options.port !== undefined ? options.port : 4310;
  let boundPort = startPort;
  await new Promise<void>((resolve, reject) => {
    function tryListen(p: number) {
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && options.port === undefined && p < 4320) tryListen(p + 1);
        else reject(err);
      });
      server.listen(p, '127.0.0.1', () => {
        const addr = server.address();
        boundPort = typeof addr === 'object' && addr ? addr.port : p;
        resolve();
      });
    }
    tryListen(startPort);
  });

  const url = `http://127.0.0.1:${boundPort}/?token=${encodeURIComponent(token)}`;
  return {
    port: boundPort,
    token,
    url,
    server,
    close: async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) { try { w.close(); } catch {} }
      for (const c of clients) { try { c.end(); } catch {} }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export function buildExportHtmlContent(
  workspaceRoot: string,
  options?: { anon?: boolean }
): string {
  const ws = path.resolve(workspaceRoot);
  const snapshot = buildUiSnapshot(ws, { anon: options?.anon });
  const rawHtml = renderUiClientHtml(snapshot, { isExport: true, token: '', anon: options?.anon });

  const scriptMatch = rawHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    return rawHtml.replace(/\r\n/g, '\n');
  }

  const scriptContent = scriptMatch[1].replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(scriptContent, 'utf8').digest('base64');
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; script-src 'sha256-${hash}'; connect-src 'none';">`;

  return rawHtml
    .replace('<meta name="viewport"', `${cspMeta}\n  <meta name="viewport"`)
    .replace(/\r\n/g, '\n');
}

export function exportUiHtml(
  workspaceRoot: string,
  outPath: string,
  options?: { anon?: boolean }
): void {
  const finalHtml = buildExportHtmlContent(workspaceRoot, options);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, finalHtml, 'utf8');
}

function parseCliOption(args: string[], flag: string): { matched: boolean; value?: string } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        return { matched: true, value: next };
      }
      return { matched: true, value: undefined };
    }
    if (a.startsWith(`${flag}=`)) {
      return { matched: true, value: a.slice(flag.length + 1) };
    }
  }
  return { matched: false, value: undefined };
}

export async function runUiCli(workspaceRoot: string, args: string[]): Promise<void> {
  const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
  const logUi = (line: string) => console.log(formatTerminalOutput(line, termOpts));
  const errUi = (line: string) => console.error(formatTerminalOutput(line, termOpts));

  const ideOpt = parseCliOption(args, '--ide');
  if (args.includes('--install-ide')) {
    logUi('🔌 Mounting EvoKernel IDE extension into detected IDEs...');
    const targetIdes = ideOpt.value
      ? ideOpt.value.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const mountRes = mountIdeExtensions(workspaceRoot, { ide: targetIdes });
    if (mountRes.mounts && mountRes.mounts.length > 0) {
      for (const m of mountRes.mounts) {
        logUi(`  ├─ ${m.name}: ${m.targetPath} (${m.method} - ${m.status})`);
      }
    } else {
      logUi('  └─ (no supported IDE extensions directory detected)');
    }
  }

  const isAnon = args.includes('--anon');
  const exportOpt = parseCliOption(args, '--export');

  if (exportOpt.matched) {
    const out =
      exportOpt.value && exportOpt.value.trim()
        ? path.resolve(exportOpt.value.trim())
        : path.join(path.resolve(workspaceRoot), 'evo-cockpit.html');
    exportUiHtml(workspaceRoot, out, { anon: isAnon });
    logUi(`✅ EvoKernel Workbench exported to: ${out}`);
    return;
  }

  const portLong = parseCliOption(args, '--port');
  const portShort = parseCliOption(args, '-p');
  const portOpt = portLong.matched ? portLong : portShort;
  let port: number | undefined;
  if (portOpt.matched) {
    if (!portOpt.value) {
      errUi('❌ Missing value for --port. Please specify a port number (e.g. --port 4310).');
      process.exitCode = 1;
      return;
    }
    const parsed = parseInt(portOpt.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
      errUi(`❌ Invalid port "${portOpt.value}". Must be a valid port number between 0 and 65535.`);
      process.exitCode = 1;
      return;
    }
    port = parsed;
  }

  const hostOpt = parseCliOption(args, '--host');
  if (hostOpt.matched) {
    if (!hostOpt.value || !hostOpt.value.trim()) {
      errUi('❌ Missing value for --host. Please specify a loopback host (e.g. --host 127.0.0.1).');
      process.exitCode = 1;
      return;
    }
    const normalizedHost = hostOpt.value.trim().toLowerCase();
    if (normalizedHost !== '127.0.0.1' && normalizedHost !== 'localhost') {
      errUi(
        `❌ Invalid --host "${hostOpt.value}". Only loopback addresses (127.0.0.1 or localhost) are permitted.`
      );
      process.exitCode = 1;
      return;
    }
  }

  const tokenOpt = parseCliOption(args, '--token');
  let token: string | undefined;
  if (tokenOpt.matched) {
    if (!tokenOpt.value || !tokenOpt.value.trim()) {
      errUi('❌ Missing value for --token. Please specify a non-empty token string.');
      process.exitCode = 1;
      return;
    }
    token = tokenOpt.value.trim();
  }

  const instance = await startUiServer(workspaceRoot, { port, token, anon: isAnon });
  logUi(`🧬 EvoKernel Workbench started at: ${instance.url}`);
  logUi('   Press Ctrl+C to terminate server.');

  const isAppMode = args.includes('--app') || args.includes('--desktop');
  const noOpen = args.includes('--no-open');
  const shouldOpen = !noOpen && (args.includes('--open') || isAppMode) && !process.env.CI && !process.argv[1]?.includes('.test.');

  if (shouldOpen) {
    if (isValidLocalHttpUrl(instance.url)) {
      if (isAppMode) {
        launchNativeDesktopWindow(instance.url, { fallbackToDefault: true });
      } else {
        launchDefaultBrowser(instance.url);
      }
    }
  }
}
