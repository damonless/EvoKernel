<div align="center">

# 🧬 EvoKernel

### 面向 AI 编程智能体的「确定性自演进元内核」

**告别越写越乱的静态 `.md` 规则文件。告别击穿 Prompt Cache 的海量 MCP 进程。**  
*80 行 L0 元规则种子 · 单一固定签名元 MCP 网关 · 4 道本地确定性沙盒门禁 · 0 第三方依赖*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.2.0-blue?style=flat-square)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(零供应链风险)-brightgreen?style=flat-square)](#零依赖原生架构)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20字节级稳定-ff6b6b?style=flat-square)](#1-为什么采用固定-5-工具的元-mcp-网关)
[![Tests](https://img.shields.io/badge/tests-242%20通过%20%7C%2010%20套件-brightgreen?style=flat-square)](#-完备测试与确定性回归验证)
[![Harnesses](https://img.shields.io/badge/10%20Harnesses-Claude%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20Cline%20%7C%20Roo%20%7C%20Copilot%20%7C%20Codex%20%7C%20OpenCode%20%7C%20Gemini%20%7C%20Antigravity-8A2BE2?style=flat-square)](#-10-大智能体接入矩阵-10-agent-harness-matrix)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

---

## ⚡ 为什么大多数“自我进化规则/技能”方案在 30 次对话后必然崩溃？

在使用 Claude Code、Cursor、Windsurf、Cline、Roo、Copilot、Codex、OpenCode、Gemini 或 Antigravity 时，开发者普遍遭遇五大工程陷阱：

1. **规则膨胀与上下文腐败（Context Rot）**：每次踩坑就往 `CLAUDE.md` 或 `.cursorrules` 追加一条 `Never do X`，很快就会演变为上万 Token、前后冲突的“规则垃圾堆”。一旦常驻规则超过 ~1,500 Tokens，大模型的 `Lost-in-the-Middle` 效应会令旧规则大面积失效。
2. **“自评自改”的幻觉固着（Worker Grading Its Own Homework）**：让同一个上下文中的 LLM 不经确定性沙盒自测直接修改全局脚本或技能，极易把包含语法错误、硬编码个人绝对路径（如 `C:\Users\Alice\...`）的损坏脚本永久固化为“持久工具”。
3. **动态 MCP 引发的 Prompt Cache 雪崩**：如果“动态进化 MCP”意味着不断向 IDE 注册新的一级 MCP 工具并触发 `list_changed`，每次工具模式改变都会**直接击穿 Claude / DeepSeek 的前缀 KV 缓存（Prompt Caching）**，导致 Token 成本暴涨 5~10 倍并伴随卡顿与重启。
4. **第三方 MCP 蔓延灾难（MCP Sprawl）**：如果直接在宿主配置中接入 10 个下游业务 MCP 服务器（Postgres、GitHub、Docker 等），宿主 System Prompt 每次都需要携带 50~100 个庞大的 JSON Schema，急剧挤占有效注意力并显著增加模型误调概率。
5. **混杂因果归因与盲目进化（Confounded Causation）**：智能体在多变量复杂排障或多次尝试后，往往盲目把成功归因于某条不相干的规则，导致误报、偏见与迷信规则在经验库中交叉污染。

**EvoKernel 用一套“离线工作区演化引擎 + 借脑宿主 + 确定性沙盒门禁 + 固定元路由网关 + 下游 MCP 虚拟化代理”彻底解决上述问题：**

```text
[修复棘手 Bug / 用户纠偏 / 交付物反馈 / 会话轨迹重放 / 挂载下游 MCP 业务服务]
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   evo_propose (MCP)     │  ◄── 100% 借脑宿主当前模型（无需额外配置任何 API Key！）
                   └────────────┬────────────┘
                                │
         ┌──────────────────────┴──────────────────────┐
         ▼                                             ▼
┌─────────────────────────────────┐   ╔═══════════════════════════════════════════════════╗
│ 离线 Git Worktree 演化优化引擎  │   ║         4 道本地确定性编译门禁 (Gatekeeper)       ║
│ (`evo optimize` inv & dom 闭环) │   ║  1. 静态 AST 与安全审计                           ║  拦截硬编码路径与高危代码
│ 独立工作树隔离 + 自动化探针评估 │   ║  2. 沙盒自测 & AST 符号存在性校验                 ║  脚本 exit 0；符号真实性绑定
└────────────────┬────────────────┘   ║  3. FTS5 BM25 相似度查重 & 防混杂归因门禁         ║  拦截重复资产 & ERR_CONFOUNDED_CAUSATION
                 │                    ║  4. 1,500 Token 硬上限与强制 GC                   ║  核心超额强制触发 evo_compact
                 │                    ╚═════════════════════╤═════════════════════════════╝
                 ▼                                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                  Git 透明文件树 (.evo/)                     │
   │  rules/ · skills/ · tools/ · memories/ · telemetry.db       │
   └─────────────────────────────┬───────────────────────────────┘
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

| 对比维度 | `MemGPT / Letta` | `Aider` | 传统 MCP 代理 (直通型) | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | **🧬 EvoKernel v0.2.0 (本项目)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **核心定位** | 有状态对话 Agent 记忆数据库 | Git 驱动的终端结对编程工具 | 聚合多个 MCP 端口的直通桥梁 | 静态工程提示词与规则合集 | 后台 LLM 演化学习 Agent | **面向 AI 编程智能体的确定性自演进元内核** |
| **接入形态** | 依赖外部服务 / Postgres / 独立进程 | 独立 Python CLI 替代主流 IDE | 暴露所有子工具到 host tools/list | 静态预置 Markdown 模板 | 劫持 `/v1/chat` 本地反向代理 | **寄生型单一 Meta-MCP + <80行元规则种子注入既有 IDE** |
| **运行时依赖** | 极重（Postgres, Python 守护进程） | Python pip 包生态 | Node 或 Python 第三方生态 | 纯文档无依赖 | Python FastAPI 守护服务 | **0 运行时依赖（纯 Node.js `>= 22.5` 原生内置：`node:sqlite`、原生 TS、`node:test`）** |
| **Prompt Cache 稳定性** | 频繁切片，缓存命中率低 | 因编辑行为而异 | **毁灭性破坏**（每次子工具变动即击穿 KV Cache 前缀） | 上下文占用过高稀释注意力 | 相对中立 | **100% 字节级稳定：对宿主仅暴露 5 个固定元工具签名** |
| **下游 MCP 虚拟化** | 无 | 无 | 无（无脑平铺所有子工具 Schema） | 无 | 无 | **零缓存失效 FTS5 索引 + 按需 stdio JSON-RPC 动态路由** |
| **门禁自测与防毒化** | 模型自我反思（无确定性保证） | Git diff 与测试执行 | 无门禁校验 | 人工运行 `/learn-eval` | 异步 LLM 评审 | **4 道确定性编译门禁（静态 AST、沙盒 exit 0、BM25、1500-tok 预算、因果防混杂）** |
| **离线 Worktree 优化** | 无 | 无 | 无 | 无 | 云端 LLM 评估 | **`evo optimize`：临时 Git Worktree 隔离、双正交维度演化、自动化探针比对与回滚保底** |
| **工程交付物审查** | 无 | 无 | 无 | 无 | 无 | **零依赖规范化校验器：内置 `.xlsx`、`.docx`、`.pptx`、CSV、JSON/JSONL、Markdown 缺陷检测** |
| **情景记忆与防漂移** | 语义向量检索（极易产生重构幻觉）| 仅 Repo Map 索引 | 无记忆体系 | 无（静态只读文档） | 无 AST 存在性校验 | **3 阶认知记忆（AST 结构指纹防刻舟求剑 + [STALE] 降权 + 拓扑穿透）** |
| **因果归因遥测** | 无 | Git diff 行数统计 | 无 | 无 | 胜率计数器 | **因果三态归因（`helped` / `hurt` / `contested`）与 `ERR_CONFOUNDED_CAUSATION` 门禁** |
| **多智能体宿主适配** | 仅独立运行时 | 仅独立运行时 | 通用 MCP 客户端 | 仅 Claude Code / Cursor | 通用代理 | **原生深度适配 10 大宿主（Claude, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, Antigravity）** |
| **冷启动基因提取** | 依赖长期对话积累 | 仅扫 Git 仓库文件 | 无初始化挖掘 | 静态模板库 | 依赖漫长会话累积 | **`evo bootstrap` 10 秒提取工程技术栈 + Git Fix 经验** |

---

## 🚀 离线 Git Worktree 演化优化引擎 (`evo optimize`)

EvoKernel v0.2.0 内置了离线自主演化优化器。它在**临时、完全隔离的 Git 工作树（Worktree）**中执行自主演化实验与回归探测，决不污染当前工作区未提交的代码状态：

```bash
# 跨 Invariant（不变式规范）与 Domain（领域排障记忆）双维度运行离线优化
evo optimize --dim both -k 3

# 基于会话轨迹与交付物进行针对性定向优化
evo optimize --trajectory session.jsonl --deliverable report.xlsx --apply
```

### 核心工程机制：
- **零脏状态污染**：工作树临时挂载于 `.evo/.cache/optimize/worktrees/opt-...`，单轮验证结束后自动强制清理。
- **正交双维度演化架构**：
  - **不变式维度 (`inv`)**：演进跨模块系统级架构规则与防踩坑底线。
  - **领域维度 (`dom`)**：演进专项模块排障经验（Episodic Memories）与规范化 SOP 技能。
- **多智能体轨迹解析与重放**：
  - 原生支持 **Antigravity**（`transcript.jsonl` 双层 JSON 反序列化）、**Codex CLI**（`thread-item` 流）、**OpenCode**（事件流）与 **Claude Code**（`stream-json`）。
- **自动化提案者与探针隔离评估**：
  - 在 Worktree 内执行 Proposer 候选提案命令。
  - 运行隔离探针脚本（Probe Command），自动计算胜率评分。
  - 若候选提案导致回归或未通过 Gatekeeper，强制执行 `KEEP_BASE` 保底回滚。

---

## 📑 零第三方依赖交付物规范化核查器 (`deliverable-canonical-inspector`)

AI 智能体常常生成“看起来像对的、但无法被专业软件读取或存在致命缺陷”的工程交付物。EvoKernel 原生提供零依赖的规范化核查沙盒微工具：

```bash
# 直接调用已注册微工具对交付物进行离线取证核验
evo_run deliverable-canonical-inspector '{"targetFile": "report.xlsx", "expectedHeaders": ["编号", "状态"]}'
```

### 全格式覆盖与缺陷防御特性：
- **电子表格 (.xlsx)**：
  - 自研 IEEE 802.3 CRC32 与 ZIP 核心解压算法，纯 Node.js 标准库实现。
  - 规范化 openpyxl 前导斜杠路径（`/xl/worksheets/sheet1.xml`）。
  - 在解析单元格文本前剔除拼音节点（`<rPh>`）干扰。
  - 精确处理自闭合单元格标签（`<c .../>`），防止后续同级单元格被意外截断吞噬。
  - 识别共享公式跟随节点，主动拦截计算公式错误（`#REF!`、`#DIV/0!`、`#VALUE!`、`t="e"`）。
  - 标记空工作表（`EMPTY_SHEET`）并比对预期表头结构。
- **文档 (.docx)**：
  - 规范化提取段落正文、带空格标题（如 `Heading 1`、`Heading 2`、`Title`）与多级表格矩阵。
  - 标记空文档缺陷（`EMPTY_DOCUMENT`）。
- **演示文稿 (.pptx)**：
  - 按幻灯片序号自然排序，结构化生成 `## Slide N` 文本块。
  - 针对空白幻灯片发出告警，精准识别空胶片（`EMPTY_PRESENTATION`）。
- **CSV 与 JSON / JSONL**：
  - 严格符合 RFC-4180 标准的 CSV 解析器，支持引号转义与换行嵌套字段。
  - 逐行校验 JSONL 的 `requiredKeys`、`strictKeys`，标记列参差（`RAGGED_COLUMNS`）。
- **Markdown (.md)**：
  - 检测未闭合的代码块围栏（`UNCLOSED_CODE_FENCE`）。
  - 精准识别遗留的模板占位符（如 `{{VARIABLE}}`、`[INSERT ...]`、`<placeholder>`），同时智能排除代码块内部的代码语法变量。

---

## 🛡️ 因果归因遥测与防混杂归因门禁 (Anti-Confounding)

绝大多数 Agent 框架的“经验积累”极易陷入“迷信经验”：由于一次会话中智能体同时修改了 5 个文件并调取了 3 个规则，便草率地将测试通过归因于全部规则。

EvoKernel 引入了**确定性因果归因机制**：
- **因果三态账本**：在 SQLite Telemetry 中记录每次会话调用的资产实际表现：
  - `helped`：直接促成测试通过且无任何次生破坏。
  - `hurt`：在导致测试失败或被 Git 回滚的会话中被调用。
  - `contested`：在经历了报错-恢复多变量尝试的复杂排障中被调用，因果关系存疑。
- **防混杂因果门禁 (`ERR_CONFOUNDED_CAUSATION`)**：
  - 当单次会话存在多个混杂变量（Confounding Variables）时，门禁强制拒绝将模糊经验提升为通用规则。
  - 必须提供反事实对比证据（Contrastive Evidence）或第三阶**拓扑穿透锚点**（精确到行列范围、调用栈链路及反例），方可完成经验固化。

---

## 🎯 10 大智能体接入矩阵与静默失败防御

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

### 静默失败纵深防御机制：
- **UTF-8 BOM 防损坏**：全面防御 `0xFEFF` 字节序标记，确保所有 JSON、TOML 与 Markdown 跨平台读写零破坏。
- **保留注释的无损配置合并**：在合并 Codex `.codex/config.toml`、`.mcp.json` 时，保留用户原有注释与兄弟服务定义。
- **零构建（Zero-Build）启动保底**：通过 `scripts/boot-mcp.mjs` 原生 TypeScript 解构技术，即使尚未运行 `dist/` 构建亦能即刻拉起。
- **空管道非阻塞（Idle Pipe Non-Blocking）防御**：在非 TTY 管道环境中提供 50ms 超时保底与即时解析退出，杜绝子进程死等 Stdin 挂死。

---

## 🪝 通用生命周期钩子路由 (`evo hook`)

EvoKernel 提供标准化 CLI 钩子路由，面向各智能体工作流（Claude Code `PostToolUse` / `Stop`、Cursor 自动化、Antigravity 原生钩子与 Git pre-commit）：

```bash
# 1. 工具执行后钩子：追踪文件变更、>=10次只读排障并按需激活作用域规则
evo hook post-tool --tool Edit --file src/core/storage.ts

# 2. 会话结束钩子：检查未结晶经验、用户纠偏反馈，发出防脏规则反向投毒告警
evo hook stop

# 3. 提交前门禁：若未验证缓存被暂存或核心规则超 1500 tokens 则拦截 Git Commit
evo hook pre-commit

# 4. 故障恢复标记：在执行命令报错恢复后记录排障经验归因
evo hook mark-recovery
```

- **单行 JSON 标准协议**：通过 `hook_trigger` 向宿主输出标准指令。
- **只读根因排障识别**：当检测到连续 `>=10` 次只读精读诊断但修改 `<4` 次时，主动提醒将排障假说证伪沉淀为情景记忆。
- **防投毒二次修改告警**：在调用 `evo_propose` 结晶后若发生二次代码变动，`stop` 钩子发出警告防止污染经验。

---

## 🔌 下游 MCP 虚拟化代理池 (MCP Proxy Virtualization)

EvoKernel 将下游多个 MCP 服务收拢在**固定 5 个元 MCP 工具**之后。智能体仅与 5 个元工具交互，即可随时搜索、检视并代理执行上百个业务 MCP 工具：

```text
宿主 AI 编程智能体 (Claude / Cursor / Copilot 等)
                  │
                  ▼ 固定 5 个元 MCP 工具 (100% 字节级保住 KV Prompt Cache)
         ╔════════════════════════════════════════════════════╗
         ║               EvoKernel Meta-MCP                   ║
         ║  evo_search · evo_inspect · evo_run · propose · compact
         ╚════════════════════════════════════════════════════╝
                  │                      │
        FTS5 BM25 自然语言检索          代理执行 (`evo_run`)
                  ▼                      ▼
        ┌────────────────────┐   ┌─────────────────────────────┐
        │ capability_fts     │   │ McpProxyManager 代理池      │
        │ ext__postgres__... │   └──────────────┬──────────────┘
        │ ext__github__...   │                  │ stdio JSON-RPC
        └────────────────────┘                  ▼
                                 ┌─────────────────────────────┐
                                 │ 下游业务 MCP 服务器集群     │
                                 │ postgres · github · docker  │
                                 └─────────────────────────────┘
```

```bash
# 预演收敛第三方 MCP 服务可节省的 Prompt Token
evo virtualize --dry-run

# 一键将零散的第三方 stdio MCP 折叠进 EvoKernel 动态代理池
evo virtualize

# 随时无损还原回宿主原始配置
evo virtualize --restore
```

---

## 🚀 60 秒快速上手 (Quick Start)

> **前置要求**：Node.js `>= 22.5` 或 `24+`（利用原生 `node:sqlite` 与原生 TypeScript 编译能力 —— **0 第三方依赖**）。

```bash
# 方式 A：在任何现有仓库中一键初始化（支持 Claude Code: /plugin marketplace add damonless/EvoKernel）
npx evo-kernel init --targets auto --stealth
npx evo-kernel virtualize --dry-run

# 方式 B：从源码编译使用（耗时 <50ms，无需任何 npm install）
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 向活跃编程智能体注入元规则种子与元 MCP
node ./dist/cli/index.js init --targets auto --stealth

# 挖掘技术栈特征与 Git Fix 经验
node ./dist/cli/index.js bootstrap --max-commits=50

# 运行离线工作树演化优化周期
node ./dist/cli/index.js optimize --dim both -k 3

# 检视自演进能力树、情景记忆 AST 状态与诊断报告
node ./dist/cli/index.js tree
node ./dist/cli/index.js memory verify
node ./dist/cli/index.js stats
node ./dist/cli/index.js audit --global
node ./dist/cli/index.js doctor
```

### 终端自演进能力树示例

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ 🧬 EvoKernel — Self-Evolving Capability Tree (.evo/)                     │
╰──────────────────────────────────────────────────────────────────────────╯
📦 Workspace: /path/to/your-repo
├── 🛡️  Rules (3 active | Core Token Budget: 317/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | hits: 4) — Every evolved Micro-Tool script must handle --self-test and exit 0.
│   ├── [CORE] esm-typescript-imports (154 tok | hits: 7) — Always use explicit .js extensions on relative imports in ESM TypeScript.
│   └── [STACK] stack-rust-core-invariants (126 tok | hits: 2) — Safe concurrency: prefer channels and arc mutex over raw pointers.
├── ⚡ Skills (3 verified L0/L1/L2 playbooks)
│   ├── [SOP] bug-to-guardrail-sop (hits: 3 | tags: debugging,evolution) — Standard workflow to turn a resolved root cause into a Rule.
│   ├── [SOP] evo-dev-verification-sop (hits: 5 | tags: dev,release) — Verification and preflight SOP for EvoKernel releases.
│   └── [SOP] evo-rule-architect (hits: 2 | tags: refactor,rules) — 4-stage rule decoupling and budget refactoring workflow.
├── 🔧 Micro-Tools (5 sandboxed scripts | Fixed Meta-MCP Routed)
│   ├── [NODE] agy-config-auditor (runs: 12 | pass: 100%) — Audits host rule budgets and memory AST symbols.
│   ├── [NODE] deliverable-canonical-inspector (runs: 18 | pass: 100%) — Zero-dep validator for .xlsx, .docx, .pptx, CSV, JSON, MD.
│   ├── [NODE] evo-release-preflight (runs: 8 | pass: 100%) — Audits multi-manifest parity and build freshness.
│   ├── [NODE] git-hotspot-analyzer (runs: 5 | pass: 100%) — Identifies top 10 frequently modified files in recent git history.
│   └── [NODE] workspace-metrics-scanner (runs: 9 | pass: 100%) — Scans file counts, LOC, and extension distribution.
└── 🧠 Episodic Memories (10 troubleshooting experiences | 10 VERIFIED · 0 STALE)
    ├── [VERIFIED] audit-broken-refs-and-hook-param-fix (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] codex-hooks-corrupt-file-unlink (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] git-fix-387153f (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] git-fix-d0d4e13 (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] harness-hook-filter-preserve-untouched-entries (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] issue-8-workspace-isolation-and-atomic-compact (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] issues-10-11-12-audit-hook-and-cross-lang-recall (confidence: HIGH | symbols: 7/7 fresh)
    ├── [VERIFIED] multi-harness-cascaded-detection-and-reversible-teardown (confidence: HIGH | symbols: 8/8 fresh)
    ├── [VERIFIED] open-idle-pipe-stdin-hang-fix (confidence: HIGH | symbols: 2/2 fresh)
    └── [VERIFIED] worktree-probe-score-improvement (confidence: HIGH | symbols: 2/2 fresh)
```

---

## 🧠 核心架构：5 个固定元工具

EvoKernel 通过 `stdio` 仅暴露**固定 5 个不可变元工具**，确保 100% 保住宿主大模型的前缀 KV 缓存：

| 元工具名称 | 渐进层级 | 核心职责 |
| :--- | :--- | :--- |
| `evo_search` | **L0** | FTS5 BM25 自然语言检索规则、技能、沙盒微工具、虚拟化外部工具与情景记忆。执行第二阶 AST 指纹防漂移核验，自动标记 `[STALE]` 记忆。 |
| `evo_inspect` | **L1 / L2** | 渐进式详情披露。按需提供三联体（现象/根因/方案）、外部工具 JSON Schema，以及第三阶**拓扑穿透锚点**（行号范围、真实调用链、反例死胡同）。 |
| `evo_run` | **执行态** | 在沙盒中执行本地微工具脚本（`.mjs`, `.py`, `.ps1`, `.sh`），或通过 `McpProxyManager` 动态代理调用下游业务 MCP。 |
| `evo_propose` | **演化入口** | 提交待固化的资产，严格通过 4 道确定性编译门禁（静态 AST 审计、沙盒自测 exit 0、BM25 去重、1,500 Token 硬上限、因果防混杂）。 |
| `evo_compact` | **GC 回收** | 原子级合并规则碎片，或将失效的 `[STALE]` 记忆归档至 `.evo/archive/`，保证核心规则常驻上下文严格受控于 1,500 Tokens 以内。 |

---

## 🧪 完备测试与确定性回归验证

EvoKernel 拥有纯原生的测试套件，由 Node 原生测试运行器（`node:test`）驱动：

```bash
node ./scripts/test.mjs
```

全量 10 大测试套件（242 个测试用例）在 ~19 秒内全数通过：
1. `dist/tests/bootstrap.test.js`: 冷启动技术栈探测与 Git Fix 基因挖掘套件 (22 tests)
2. `dist/tests/deliverable-inspector.test.js`: 零依赖交付物规范化解析与缺陷审查套件 (33 tests)
3. `dist/tests/evo-kernel.test.js`: 核心门禁、沙盒、AST 认知记忆与核心规范套件 (27 tests)
4. `dist/tests/harness2-borrowings.test.js`: 因果归因三态遥测与防混杂门禁套件 (30 tests)
5. `dist/tests/harness2-wave1.test.js`: 第一波宿主与生命周期钩子加固套件 (20 tests)
6. `dist/tests/harness2-wave4-audit.test.js`: 多宿主静默失败矩阵审计与防御套件 (33 tests)
7. `dist/tests/hook.test.js`: 通用钩子路由与空管道 Stdin 非阻塞弹性套件 (27 tests)
8. `dist/tests/mcp-proxy.test.js`: 下游 MCP 动态虚拟化代理握手与路由套件 (10 tests)
9. `dist/tests/multi-harness.test.js`: 10 大智能体宿主无损配置合并与隐身排除套件 (14 tests)
10. `dist/tests/optimize.test.js`: 离线 Git Worktree 演化优化引擎套件 (16 tests)

---

## 📄 开源许可证

MIT License — 详见 [LICENSE](LICENSE)。
