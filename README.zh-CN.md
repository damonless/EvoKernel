<div align="center">

# 🧬 EvoKernel

### 面向 AI 编程智能体的「确定性自演进元内核」

**告别越写越乱的静态 `.md` 规则文件。告别击穿 Prompt Cache 的海量 MCP 进程。**  
*80 行 L0 元规则种子 · 单一固定签名元 MCP 网关 · 4 道本地确定性沙盒门禁 · 0 第三方依赖*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(零供应链风险)-brightgreen?style=flat-square)](#零依赖原生架构)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20字节级稳定-ff6b6b?style=flat-square)](#1-为什么采用固定-5-工具的元-mcp-网关)
[![Harnesses](https://img.shields.io/badge/10%20Harnesses-Claude%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20Cline%20%7C%20Roo%20%7C%20Copilot%20%7C%20Codex%20%7C%20OpenCode%20%7C%20Gemini%20%7C%20Antigravity-8A2BE2?style=flat-square)](#-10-大智能体接入矩阵-10-agent-harness-matrix)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

---

## ⚡ 为什么大多数“自我进化规则/技能”方案在 30 次对话后必然崩溃？

在使用 Claude Code、Cursor、Windsurf、Cline、Roo、Copilot、Codex、OpenCode、Gemini 或 Antigravity 时，开发者普遍遭遇四大工程陷阱：

1. **规则膨胀与上下文腐败（Context Rot）**：每次踩坑就往 `CLAUDE.md` 或 `.cursorrules` 追加一条 `Never do X`，很快就会演变为上万 Token、前后冲突的“规则垃圾堆”。一旦常驻规则超过 ~1,500 Tokens，大模型的 `Lost-in-the-Middle` 效应会令旧规则大面积失效。
2. **“自评自改”的幻觉固着（Worker Grading Its Own Homework）**：让同一个上下文中的 LLM 不经确定性沙盒自测直接修改全局脚本或技能，极易把包含语法错误、硬编码个人绝对路径（如 `C:\Users\Alice\...`）的损坏脚本永久固化为“持久工具”。
3. **动态 MCP 引发的 Prompt Cache 雪崩**：如果“动态进化 MCP”意味着不断向 IDE 注册新的一级 MCP 工具并触发 `list_changed`，每次工具模式改变都会**直接击穿 Claude / DeepSeek 的前缀 KV 缓存（Prompt Caching）**，导致 Token 成本暴涨 5~10 倍并伴随卡顿与重启。
4. **第三方 MCP 蔓延灾难（MCP Sprawl）**：如果直接在宿主配置中接入 10 个下游业务 MCP 服务器（Postgres、GitHub、Docker 等），宿主 System Prompt 每次都需要携带 50~100 个庞大的 JSON Schema，急剧挤占有效注意力并显著增加模型误调概率。

**EvoKernel 用一套“借脑宿主 + 确定性沙盒门禁 + 固定元路由网关 + 下游 MCP 虚拟化代理”彻底解决上述问题：**

```text
[修复棘手 Bug / 用户纠偏 / 临时脚本 / 挂载下游 MCP 业务服务]
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   evo_propose (MCP)     │  ◄── 100% 借脑宿主当前模型（无需额外配置任何 API Key！）
                   └────────────┬────────────┘
                                ▼
  ╔═══════════════════════════════════════════════════════╗
  ║         4 道本地确定性编译门禁 (Gatekeeper)           ║
  ║  1. 静态 AST 与安全审计                               ║  拦截硬编码路径、明文凭证与 rm -rf 高危指令
  ║  2. 沙盒自测 & AST 符号存在性校验                     ║  脚本必须 exit 0；情景记忆校验目标符号真实性并绑定 AST 指纹
  ║  3. FTS5 BM25 相似度查重                              ║  拦截重复造轮子与相似排障经验，强制升级旧资产
  ║  4. 1,500 Token 硬上限与强制 GC                       ║  核心规则超额时拒绝写入，强制触发 evo_compact 压缩整合
  ╚═════════════════════════════╤═════════════════════════╝
                                ▼
                   ┌─────────────────────────┐
                   │ Git 透明文件树 (.evo/)  │
                   └────────────┬────────────┘
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
┌─────────────────────────┐           ┌─────────────────────────┐
│ 固定 5 个元 MCP 工具    │           │ 下游 MCP 虚拟化代理池   │
│ (100% 保住前缀 KV 缓存) │           │ (无感知集成 10+ MCP)    │
└─────────────────────────┘           └─────────────────────────┘
```

---

## 📊 行业同类项目全景对比矩阵

| 对比维度 | `MemGPT / Letta` | `Aider` | 传统 MCP 代理 (直通型) | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | **🧬 EvoKernel (本项目)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **核心定位** | 有状态对话 Agent 记忆数据库 | Git 驱动的终端结对编程工具 | 聚合多个 MCP 端口的直通桥梁 | 静态工程提示词与规则合集 | 后台 LLM 演化学习 Agent | **面向 AI 编程智能体的确定性自演进元内核** |
| **接入形态** | 依赖外部服务 / Postgres / 独立进程 | 独立 Python CLI 替代主流 IDE | 暴露所有子工具到 host tools/list | 静态预置 Markdown 模板 | 劫持 `/v1/chat` 本地反向代理 | **寄生型单一 Meta-MCP + <80行元规则种子注入既有 IDE** |
| **运行时依赖** | 极重（Postgres, Python 守护进程） | Python pip 包生态 | Node 或 Python 第三方生态 | 纯文档无依赖 | Python FastAPI 守护服务 | **0 运行时依赖（纯 Node.js `>= 22.5` 原生内置：`node:sqlite` + 原生 TS）** |
| **Prompt Cache 稳定性** | 频繁切片，缓存命中率低 | 因编辑行为而异 | **毁灭性破坏**（每次子工具变动即击穿 KV Cache 前缀） | 上下文占用过高稀释注意力 | 相对中立 | **100% 字节级稳定：对宿主仅暴露 5 个固定元工具签名** |
| **下游 MCP 虚拟化** | 无 | 无 | 无（无脑平铺所有子工具 Schema） | 无 | 无 | **零缓存失效 FTS5 索引 + 按需 stdio JSON-RPC 动态路由** |
| **门禁自测与防毒化** | 模型自我反思（无确定性保证） | Git diff 与测试执行 | 无门禁校验 | 人工运行 `/learn-eval` | 异步 LLM 评审 | **4 道确定性编译门禁（静态 AST、沙盒 exit 0、BM25、1500-tok 预算）** |
| **情景记忆与防漂移** | 语义向量检索（极易产生重构幻觉）| 仅 Repo Map 索引 | 无记忆体系 | 无（静态只读文档） | 无 AST 存在性校验 | **3 阶认知记忆（AST 结构指纹防刻舟求剑 + [STALE] 降权 + 拓扑穿透）** |
| **多智能体宿主适配** | 仅独立运行时 | 仅独立运行时 | 通用 MCP 客户端 | 仅 Claude Code / Cursor | 通用代理 | **原生深度适配 10 大宿主（Claude, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, Antigravity）** |
| **冷启动基因提取** | 依赖长期对话积累 | 仅扫 Git 仓库文件 | 无初始化挖掘 | 静态模板库 | 依赖漫长会话累积 | **`evo bootstrap` 10 秒提取工程技术栈 + Git Fix 经验** |

---

## 🎯 10 大智能体接入矩阵 (10-Agent Harness Matrix)

EvoKernel 通过无损标记块（Marker Block）和 Git 隐身模式，原生且干净地对接 10 大主流 AI 编程智能体环境：

| 智能体 / 宿主 | 规则注入目标文件 | MCP 网关配置目标 | 自动检测触发条件 | Git 隐身模式 (`.git/info/exclude`) |
| :--- | :--- | :--- | :--- | :---: |
| **Claude Code** | `CLAUDE.md` | `.mcp.json` + `.claude/settings.json` | `CLAUDE.md`, `.claude/`, `CLAUDE_CONFIG_DIR`, `~/.claude` | ✅ |
| **Cursor** | `.cursor/rules/evo-kernel.mdc` | `.cursor/mcp.json` | `.cursor/`, `.cursorrules`, `CURSOR_AGENT`, `~/.cursor` | ✅ |
| **Windsurf** | `.windsurfrules` | `.windsurf/mcp.json` | `.windsurf/`, `.windsurfrules`, `WINDSURF_DIR`, `~/.windsurf` | ✅ |
| **Cline** | `.clinerules` | `.cline/mcp.json` | `.clinerules`, `.cline/`, `CLINE_DIR`, `~/.cline` | ✅ |
| **Roo Code** | `.roo/rules/evo-kernel.md` | `.roo/mcp.json` | `.roo/`, `.roorules`, `ROO_DIR`, `~/.roo` | ✅ |
| **GitHub Copilot / VS Code** | `.github/copilot-instructions.md` | `.vscode/mcp.json` | `.github/copilot-instructions.md`, `.vscode/`, `VSCODE_PID` | ✅ |
| **Codex CLI** | `AGENTS.md` | `.codex/config.toml` | `.codex/`, `CODEX_HOME`, `~/.codex` | ✅ |
| **OpenCode** | `opencode.json` + `AGENTS.md` | `opencode.json` | `opencode.json`, `.opencode/`, `OPENCODE_CONFIG` | ✅ |
| **Gemini CLI** | `GEMINI.md` | `.gemini/settings.json` | `GEMINI.md`, `.gemini/`, `GEMINI_CLI_HOME`, `~/.gemini` | ✅ |
| **Antigravity** | `GEMINI.md` | `mcp_config.json` + `.mcp.json` | `mcp_config.json`, `ANTIGRAVITY_AGENT`, `~/.antigravity` | ✅ |

- **三阶级联自动检测**：执行 `evo init --targets auto` 时，自动探测工作区文件、环境变量与全局 Home 目录特征，仅初始化当前真实存在的宿主。
- **本地 Git 隐身模式**：执行 `evo init --stealth` 会将所有生成文件与目录登记到 `.git/info/exclude`（支持 Monorepo 相对子路径前缀），完全不污染 Git 状态，严禁修改受版本控制的 `.gitignore`。
- **可逆干净卸载**：执行 `evo uninstall` 会移除由 EvoKernel 托管的标记块与 MCP 条目，清理空目录，并精准清除属于该工作区的隐身排除项，绝不触碰用户手写的永久规则与业务 MCP 服务。

---

## 🔌 下游 MCP 虚拟化代理 (Downstream MCP Proxy Virtualization)

### 痛点：海量 MCP 导致的 Prompt Cache 击穿与上下文浪费
当开发者直接把 PostgreSQL、GitHub、Docker、AWS、Jira 等 10 个业务 MCP 挂载到宿主智能体中时：
- 每次对话请求的 System Prompt 必须携带 **50~100 个复杂的 JSON Schema**，开局即消耗 5,000~12,000 个静态 Token。
- 只要其中任意一个 MCP 更新了版本、新增了参数或发生了重启，宿主模型的 **KV Prompt Cache 前缀将被全量冲刷失效**，带来极高的 Token 成本与响应延迟。
- 选项过多会引发大模型的注意力涣散，工具调用幻觉与错参率显著攀升。

### EvoKernel 解决方案：元 MCP 虚拟化代理池
EvoKernel 将下游业务 MCP 虚拟化隐藏在 **5 个固定元工具** 背后。宿主智能体始终只感知到 5 个轻量元工具，而下游成百上千个业务工具变成了“按需检索、按需展开、透明代理执行”：

```text
宿主智能体 (Claude / Cursor / Copilot 等)
                  │
                  ▼ 固定 5 个元工具通信 (100% 保住 KV Cache 前缀)
         ╔════════════════════════════════════════════════════╗
         ║               EvoKernel Meta-MCP                   ║
         ║  evo_search · evo_inspect · evo_run · propose · compact
         ╚════════════════════════════════════════════════════╝
                  │                      │
       FTS5 BM25 毫秒检索         透明代理执行 (`evo_run`)
                  ▼                      ▼
       ┌────────────────────┐   ┌─────────────────────────────┐
       │ capability_fts     │   │ McpProxyManager (连接池)    │
       │ ext__postgres__... │   └──────────────┬──────────────┘
       │ ext__github__...   │                  │ stdio JSON-RPC
       └────────────────────┘                  ▼
                                ┌─────────────────────────────┐
                                │ 下游真实 MCP 业务子进程     │
                                │ postgres · github · docker  │
                                └─────────────────────────────┘
```

### 1. 一键收编虚拟化 `evo virtualize`（推荐）
直接运行 `evo virtualize`，即可自动扫描工作区各宿主配置（`.mcp.json`、`.cursor/mcp.json`、`.windsurf/mcp.json`、`.vscode/mcp.json`、`.gemini/settings.json`、`opencode.json`、`.codex/config.toml`），将所有臃肿的第三方 stdio MCP 一键折叠进 `.evo/mcp-pool.json` 与 `.evo/config.json` (`externalServers`)，宿主工具列表中仅保留 `evo-kernel` 的 5 个固定元工具：

```bash
# 预览可节省的常驻 Schema Token（不修改任何文件）
evo virtualize --dry-run

# 一键收编所有第三方 stdio MCP 进入 EvoKernel 动态代理池
evo virtualize

# 随时无损回滚恢复到原宿主配置文件
evo virtualize --restore
```

也可在 `.evo/config.json` 中手动声明 `externalServers`：

```json
{
  "maxCoreRuleTokens": 1500,
  "externalServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx" }
    }
  }
}
```

### 2. 零缓存击穿的三步工作流
1. **自动发现与命名空间注册**：EvoKernel 在后台与外部 MCP 完成握手并缓存工具清单（存入 `.evo/.cache/external-tools.json` 与 SQLite `capability_fts`），自动生成防碰撞 ID：`ext__<server>__<tool>`（如 `ext__postgres__query_db`）。
2. **毫秒检索 (`evo_search`)**：智能体通过语义检索召回工具，消耗 `<30 Tokens`：
   ```json
   evo_search({ "query": "查询数据库用户订单", "kind": "tool" })
   ```
   *返回*：包含 `ext__postgres__query_db` 的 L0 摘要。
3. **渐进展开 (`evo_inspect`)**：
   - `L1`：按需返回该下游工具真实的入参 JSON Schema。
   - `L2`：返回完整的路由执行契约与调用样例。
4. **透明执行 (`evo_run`)**：
   ```json
   evo_run({
     "tool_id": "ext__postgres__query_db",
     "args": { "sql": "SELECT id, name FROM users LIMIT 5;" }
   })
   ```
   EvoKernel 自动通过连接池调度 `postgres` 真实子进程执行该指令，截获标准输出并结构化回传宿主。

---

## 🪝 全局生命周期 Hook 路由器 (Universal Hook Router)

EvoKernel 提供标准化 CLI Hook 路由器 (`evo hook <event>`)，无缝嵌入 Claude Code `PostToolUse` / `Stop` 钩子、Cursor 自动化以及 Git 预提交防护：

```bash
# 1. 工具执行后钩子：追踪未沉淀的代码变更、只读诊断（>=10 次读取），并自动激活关联范围规则
evo hook post-tool --tool Edit --file src/core/storage.ts

# 2. 会话停顿钩子：触发结晶建议（代码修改、>=10 次只读排障或用户反问纠偏），并对沉淀后的二次代码篡改发出防毒化告警
evo hook stop

# 3. 提交前门禁：若暂存了内部缓存或规则 Token 超出 1500 上限，阻断 Git 提交
evo hook pre-commit
```

- **路径级规则自动召回**：当智能体修改源码时，`post-tool` 会根据通配符模式（如 `src/**/*.ts` 或 `firmware/**/*.c`）自动把当前领域规则激活并注入提示。
- **只读白盒排障与反问纠偏感知**：当会话发生深度只读排障（`>= 10` 次读取且 `< 4` 次修改）或检测到用户反问/纠偏时，自动触发经验结晶提醒。
- **防毒化反转告警（Anti-Poisoning Alert）**：若智能体在完成一次经验提炼（`evo_propose`）后又擅自修改了相关源码但未重新自测，`evo hook stop` 会发出红色告警，防止错误代码毒化经验库。
- **Git 提交硬预算门禁**：在提交代码前由 `pre-commit` 严格审查规则 Token 消耗与敏感文件（核心常驻规则上限 1,500 tokens；按需 L2 `SKILL.md` 独立放宽至 3,000 tokens），杜绝将臃肿的规则和私有数据库推送到远端。

---

## 🚀 60 秒快速开始

> **环境要求**：Node.js `>= 22.5` 或 `24+`（基于原生内置 `node:sqlite` 与原生 TS 剥离器构建 —— **0 第三方依赖，无需 `npm install` 等待**）。

```bash
# 方式 A：在任意工程内通过 npx 一键注入（或 Claude Code 内执行：/plugin marketplace add damonless/EvoKernel）
npx evo-kernel init --targets auto --stealth
npx evo-kernel virtualize --dry-run

# 方式 B：从源码克隆并编译（耗时 <50ms，零外部依赖）
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 自动检测并无损接入既有智能体（可选 --stealth 启用本地隐身模式）
node ./dist/cli/index.js init --targets auto --stealth

# 一键将第三方 stdio MCP 收编折叠至 EvoKernel 零膨胀动态代理池
node ./dist/cli/index.js virtualize

# 冷启动仓库基因挖掘：扫描工程技术栈（Rust/Go/Python/Java/TS/C++）与 Git Fix 历史
node ./dist/cli/index.js bootstrap --max-commits=50

# 查看自演进能力树、多分支情景记忆 AST 新鲜度、ROI 遥测账本与规则审计
node ./dist/cli/index.js tree
node ./dist/cli/index.js memory verify
node ./dist/cli/index.js stats
node ./dist/cli/index.js audit --global
node ./dist/cli/index.js refactor
```

### 终端实时输出样例

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ 🧬 EvoKernel — 自演进工程能力树 (.evo/)                                  │
╰──────────────────────────────────────────────────────────────────────────╯
📦 当前工作区: /path/to/your-repo
├── 🛡️  规则资产 (3 条生效 | 核心规则预算: 412/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | 命中: 4) — 演进的微工具脚本必须处理 --self-test 且安全退出 0。
│   ├── [CORE] esm-typescript-imports (154 tok | 命中: 7) — 在 ESM TypeScript 中始终对相对导入使用明确的 .js 扩展名。
│   └── [STACK] stack-rust-core-invariants (126 tok | 命中: 2) — 优先采用 channels/Arc<Mutex> 代替裸指针。
├── ⚡ 技能流程 (1 份已验证 L0/L1/L2 战术剧本)
│   └── [SOP] bug-to-guardrail-sop (命中: 3 | 标签: debugging,evolution) — 将已定位根因转化为规则或微工具的标准 SOP。
├── 🔧 沙盒微工具 (3 个持久脚本 | 经固定 Meta-MCP 路由调度)
│   ├── [NODE] git-hotspot-analyzer (调用: 5 | 成功率: 100%) — 分析近 100 次提交中最高频变动的文件以定位脆弱模块。
│   ├── [NODE] workspace-metrics-scanner (调用: 9 | 成功率: 100%) — 一键统计代码行数与扩展名分布，不污染会话窗口。
│   └── [PROXY] ext__postgres__query_db (调用: 12 | 成功率: 100%) — [外部: postgres] 在 PostgreSQL 数据库上执行只读 SQL。
└── 🧠 认知情景记忆 (1 条排障实录 | 1 条已验证 · 0 条已过期)
    └── [VERIFIED] mem-git-fix-insights (置信度: HIGH | 目标符号: 2/2 新鲜 | 命中: 2) — 从近期 Git 历史修复提交中提取的排障实录。
```

---

## 🧠 5 个固定元工具契约（永不击穿 Prompt Cache）

EvoKernel 对宿主智能体仅暴露 **5 个固定签名的元工具**，从根本上锁死前缀 KV 缓存：

| 元工具名 | 披露层级 | 核心职责 |
| :--- | :--- | :--- |
| `evo_search` | **L0 摘要层** | 基于 SQLite FTS5 (BM25) 毫秒级检索规则、技能、本地微工具、虚拟化下游工具及情景记忆；实时计算 AST 指纹对重构符号标记 `[STALE]` 并降权。 |
| `evo_inspect` | **L1 / L2 详情层** | 渐进式展开披露。返回排障三元组、虚拟化工具的 JSON Schema 以及 **拓扑穿透锚点**（实时行号区间、调用链路与反面避坑警示）。 |
| `evo_run` | **沙盒执行层** | 在超时受控的子进程沙盒中执行本地微工具（`.mjs` / `.py` / `.ps1` / `.sh`），或通过 `McpProxyManager` 透明代理执行下游 MCP 业务。 |
| `evo_propose` | **门禁演进层** | 提交新提炼的 Rule、Skill、Micro-Tool 或 Memory 候选，同步触发本地 4 道确定性 Gatekeeper 审查，通过后原子落盘。 |
| `evo_compact` | **垃圾回收层 (GC)** | 当核心规则触及 1,500 Token 红线或记忆因代码变更成为 `[STALE]` 时，将碎片归档至 `.evo/archive/` 并原子整合最新资产。 |

---

## 🧪 零依赖测试套件验证

EvoKernel 自带基于 Node.js 原生测试运行器（`node:test`）构建的完整验证套件：

```bash
node ./scripts/test.mjs
```

全量 5 大测试套件（100+ 测试用例）仅需 ~5 秒全部通过：
1. `dist/tests/evo-kernel.test.js`：核心门禁、沙盒执行、AST 认知记忆防漂移与元规则。
2. `dist/tests/multi-harness.test.js`：10 大智能体接入矩阵、无损标记块合并与 Git 隐身模式。
3. `dist/tests/hook.test.js`：全局 Hook 路由器、通配符作用域匹配与防毒化反转告警。
4. `dist/tests/bootstrap.test.js`：冷启动多技术栈检测（Rust, Go, Python, Java, TS, C/C++）与 Git Fix 经验提取。
5. `dist/tests/mcp-proxy.test.js`：下游 MCP 虚拟化代理握手、FTS5 检索发现与 Stdio JSON-RPC 转发。

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
