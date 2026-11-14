<div align="center">

# 🧬 EvoKernel (evo-kernel)

### 让 AI 编程助手告别跨会话重复踩坑 —— AST 级防漂移认知记忆与 6 道确定性沙盒门禁，削减 88.7% 会话启动 Token 税，纯原生 0 外部依赖。

**面向 AI 编程智能体的「确定性自演进元内核」与认知上下文操作系统**  
*Claude Code · Cursor · Codex · Windsurf · Cline · Roo · GitHub Copilot · OpenCode · Gemini · Antigravity*

[![CI & Gatekeeper Audit](https://github.com/damonless/EvoKernel/actions/workflows/ci.yml/badge.svg)](https://github.com/damonless/EvoKernel/actions/workflows/ci.yml)
[![EvoKernel Workbench Demo](https://img.shields.io/badge/EvoKernel_Workbench-在线交互演示-38bdf8?style=flat-square&logo=github)](https://damonless.github.io/EvoKernel/demo/)
[![EvoKernel Score](https://img.shields.io/badge/EvoKernel_Score-100%2F100_(A%2B)-34d399?style=flat-square)](#-30-秒极速上手)
[![Version](https://img.shields.io/badge/npm-v0.4.0-blue?style=flat-square&logo=npm)](https://www.npmjs.com/package/evo-kernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(零供应链风险)-brightgreen?style=flat-square)](#-零依赖原生架构)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20字节级稳定-ff6b6b?style=flat-square)](#-核心架构5-个固定元工具原语)
[![Tests](https://img.shields.io/badge/tests-336%20通过%20%7C%2011%20套件-brightgreen?style=flat-square)](#-完备测试与确定性回归验证)

**[English](README.md) · [简体中文](README.zh-CN.md) · [🌐 产品主页](https://damonless.github.io/EvoKernel/) · [🖥️ 在线交互式工作台 (EvoKernel Workbench)](https://damonless.github.io/EvoKernel/demo/) · [📊 基准评测 (Benchmarks)](benchmarks/README.md)**

<br/>

<a href="https://damonless.github.io/EvoKernel/"><img src="./assets/hero-shotcraft.svg" alt="EvoKernel 认知记忆、确定性沙盒门禁与基准遥测" width="100%" /></a>

</div>

> **EvoKernel 是什么？** EvoKernel 为你的 AI 编程助手装备**跨会话 AST 级防漂移认知记忆、单行可见召回回执（`🛡️ EvoKernel Recall`）与 6 道确定性沙盒门禁**，让修过的 Bug 绝不在新会话中重演；同时将臃肿的第三方 MCP 工具定义与巨石规则文件折叠进 5 个固定元工具原语（**削减 88.7% 会话启动 Token 税：`27,150 → 3,066` tok/轮、100% KV 缓存命中、0 外部依赖**）。

> [!NOTE]
> **消歧说明：** EvoKernel (`evo-kernel`) 是面向 AI 编程智能体（Claude Code、Cursor、Windsurf、Codex、Gemini 等）的智能体架构与上下文工程框架，与同名的学术 ICML 论文/基准测试或 Linux 内核项目无关。

---

## ⚡ 30 秒极速上手

只需 3 条命令，无需安装任何全局 npm 包：

```bash
# 1. 毫秒级零写入 X-Ray 诊断 (<25ms) — 扫描宿主规则、Git 热点与记忆覆盖率
npx -y evo-kernel score

# 2. 一键安全接入与环境体检 — 安全预览 MCP 虚拟化
npx -y evo-kernel init --stealth && npx -y evo-kernel doctor
# (如需预览 MCP 虚拟化节省的 Token，可执行：npx -y evo-kernel virtualize --dry-run)

# 3. 启动 EvoKernel Workbench 可视化工作台，检视能力树、AST 记忆与近 7 日召回实绩
npx -y evo-kernel ui
```

> 💡 **Node.js 18 / 20 免全局升级一键极速体验：**  
> `npx -y -p node@22 evo-kernel score`  
> *（注：`npx -p node@22` 仅推荐用于单次 CLI 体检；若需长期挂载后台 MCP 服务，请将系统 Node 升级至 `>= 22.5.0`：`nvm install 22 && nvm use 22` 或 `fnm use 22`，并推荐全局安装：`npm install -g evo-kernel`）*  
> *为什么需要 Node.js >= 22.5.0？* EvoKernel 基于 Node 22 原生内置的 `node:sqlite`、`node:module` 与 `node:test` 构建，实现 **0 外部第三方 npm 依赖与 0 供应链安全投毒风险**。

<details>
<summary><b>🖥️ 可视化界面导览：3 步终端流水线、EvoKernel Workbench 工作台与 X-Ray 诊断卡 (点击展开)</b></summary>

<br/>

<div align="center">
  <img src="./assets/quickstart-shotcraft.svg" alt="EvoKernel 30 秒极速上手全流程" width="100%" />
</div>

<br/>

<table>
<tr>
<td align="center" width="56%">
  <b>EvoKernel Workbench (<code>npx evo-kernel ui</code>)</b><br/>
  <a href="https://damonless.github.io/EvoKernel/demo/"><img src="./assets/workbench-showcase.png" width="100%" alt="EvoKernel Workbench — 能力树、AST 认知记忆与 7 日召回实景" /></a>
</td>
<td align="center" width="44%">
  <b>终端矢量 X-Ray 诊断卡 (<code>npx evo-kernel score</code>)</b><br/>
  <img src="./assets/terminal-score-xray.svg" width="100%" alt="EvoKernel Terminal Score X-Ray Card" />
</td>
</tr>
</table>

</details>

<details>
<summary><b>🛠️ 源码克隆构建、CI 交付物核检与高级 CLI 流程 (点击展开)</b></summary>

```bash
# 从源码克隆并编译（编译耗时 <50ms，无需任何 npm install）
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 将 L0 元规则种子与单一固定元 MCP 注入当前生效的编码智能体
node ./dist/cli/index.js init --targets auto --stealth

# 冷启动挖掘当前仓库架构、技术栈规约与 Git 历史 Bug 修复基因
node ./dist/cli/index.js bootstrap --max-commits=50

# 运行离线 Git Worktree 能力演化优化循环
node ./dist/cli/index.js optimize --dim both -k 3

# CI / 工程交付物规范核检（支持 .xlsx, .docx, .pptx, .csv, .json, .md）
npx -y evo-kernel check ./README.md

# 检查能力树结构、多分支 AST 记忆时效性与实时 MCP 握手体检
node ./dist/cli/index.js tree
node ./dist/cli/index.js memory verify
node ./dist/cli/index.js doctor --roi
node ./dist/cli/index.js audit --global
```

</details>

---

## 🔒 可逆性与团队协作及隐私安全保障

EvoKernel 从设计之初就坚持极低试错门槛、完全透明可审查与随时 100% 干净回退：

### 1. `evo init` 动了哪些文件与一键无损卸载还原
执行 `npx evo-kernel init` 时，仅精准修改以下三处隔离边界：
- **宿主 Agent 规则文件**：在检测到的宿主规则文件（`CLAUDE.md`、`AGENTS.md`、`.cursor/rules/evo-kernel.mdc`，或在存在 `.gemini/` 目录时注入 `GEMINI.md`——自动检测模式下避免根目录重复注入相同块）中插入紧凑（<1,100 tok）、由 `<!-- EVO:START -->` 与 `<!-- EVO:END -->` 严格包裹的受控元规则块。标记块之外的原有规则内容绝不触碰。
- **宿主 MCP 配置文件**：仅为宿主注册唯一的 `evo-kernel` stdio 元网关服务项（未执行虚拟化时绝不修改已有第三方 MCP 配置）。
- **项目本地 `.evo/` 资产目录**：初始化局部能力树与情景记忆结构（`.evo/rules/`, `.evo/skills/`, `.evo/memories/`, `.evo/tools/`, `.evo/.cache/`）。

若需将项目与宿主配置完全还原至接入前的初始状态，仅需一条命令：
```bash
npx -y evo-kernel virtualize --restore && npx -y evo-kernel uninstall
```
该命令会自动还原已虚拟化的第三方 MCP 配置、彻底剥离所有宿主规则中的 `<!-- EVO:START -->` 注入块、清理注册的生命周期 Hook，并安全删除 `.evo/` 目录，实现**零残留无损还原**。

### 2. 多人团队协作共享 vs. `--stealth` 个人无痕试用模式
- **多人团队协作共享（默认 `evo init`）**：将 `.evo/rules/`、`.evo/memories/` 与 `.evo/tools/` 提交至 Git 远端仓库。团队中所有成员及其编码智能体均可实时复用沉淀的根因排障记忆与受控沙盒微工具；内部临时缓存（`.evo/.cache/`）已自动加入忽略规则。
- **个人独立试用他人/开源仓库（`evo init --stealth`）**：自动将 `.evo/` 及修改的宿主配置文件写入本地 `.git/info/exclude`，完全不修改项目 `.gitignore`，更不会产生任何未提交的 Git 工作区脏变更。实现**零 Git 污染、零提交干扰**。

### 3. 100% 本地优先与零外发遥测
EvoKernel **不包含任何网络外发请求**，不收集任何用户使用数据，也无需联网调用任何外部云端 API。所有 SQLite FTS5 索引与可观测召回账本（`.evo/.cache/telemetry.db`）100% 保存在本地开发者机器中。

---

## 📈 50 轮上下文税推演模型与本地引擎微基准实测 (`npm run benchmark`)

基于典型全栈工程挂载 **8 个主流 MCP 服务**（`github`, `playwright`, `kubernetes`, `docker`, `linear`, `postgres`, `sentry`, `context7` —— 共计 **77 个工具**）+ 成熟仓库知识库（10 条规则、4 个技能、5 个微工具、15 条排障记忆），在 **50 轮连续对话 + 3 次中途规则/工具演进**下的上下文税分析推演模型与本地引擎微基准实测（本地执行 `npm run benchmark` 即可复现）。
*零前缀失效前提说明*：0 次中途缓存击穿建立在新演进资产以默认的 `core: false` 领域规则（Scoped Rules）、技能、微工具或排障记忆（`memory`）形态沉淀至 `.evo/` 的前提之上——此类演进不修改顶层 `tools/list` Schema 与宿主 `CLAUDE.md` 常驻 L0 前缀。

| 核心指标 | 传统直连多 MCP + 巨石 `CLAUDE.md` | **🧬 EvoKernel 5-Tool 虚拟网关** | 推演/实测收益 |
| :--- | :---: | :---: | :---: |
| **暴露给模型的工具 Schema** | 77 个工具定义 (`14,700` tok) | **5 个固定元工具原语 (`1,916` tok)** | **-93.5% Schema 数量 (`-87.0%` 体积)** |
| **会话启动静态前缀税 / 轮** | 27,150 tokens | **3,066 tokens** | **-88.7% 会话启动 Token 税削减** |
| **中途演进引发的缓存击穿** | 3 次全量前缀重算 | **0 次（100% 命中缓存）** | **100% KV Cache 护盾** |
| **50 轮累计输入 Tokens** | 1,931,250 tokens | **738,570 tokens** | **-61.8% 累计负载** |
| **50 轮账单成本 (Claude Sonnet 4.5)** | \$1.15 | **\$0.34** | **节省 70.4% API 成本** |
| **50 轮账单成本 (Claude Opus 4.5)** | \$5.76 | **\$1.70** | **节省 70.4% API 成本** |
| **本地引擎 AST 校验速率** | 无校验（重构后静默腐败） | **~1.2 ms / 条记忆** | **~49ms 批量校验 41 条记忆¹** |

> ¹ *术语说明：* AST 防漂移/符号指纹采用**零依赖词法-结构骨架指纹（Zero-Dep Lexical-Structural Skeleton Fingerprinting）**，无需外部重型编译器即可对注释修改、代码格式化和行号漂移天然免疫。

---

## ⚡ 为什么大多数“自我进化规则/技能”方案在 30 次对话后必然崩溃？

在使用 Claude Code、Cursor、Windsurf、Cline、Roo、Copilot、Codex、OpenCode、Gemini 或 Antigravity 时，开发者普遍遭遇五大工程陷阱：

1. **规则膨胀与上下文腐败（Context Rot）**：每次踩坑就往 `CLAUDE.md` 或 `.cursorrules` 追加一条 `Never do X`，很快就会演变为上万 Token、前后冲突的“规则垃圾堆”。一旦常驻规则超过 ~1,500 Tokens，大模型的 `Lost-in-the-Middle` 效应会令旧规则大面积失效。
2. **“自评自改”的幻觉固着（Worker Grading Its Own Homework）**：让同一个上下文中的 LLM 不经确定性沙盒自测直接修改全局脚本或技能，极易把包含语法错误、硬编码个人绝对路径（如 `C:\Users\Alice\...`）的损坏脚本永久固化为“持久工具”。
3. **动态 MCP 引发的 Prompt Cache 雪崩**：如果“动态进化 MCP”意味着不断向 IDE 注册新的一级 MCP 工具并触发 `list_changed`，每次工具模式改变都会**直接击穿 Claude / DeepSeek 的前缀 KV 缓存（Prompt Caching）**，导致 Token 成本暴涨 5~10 倍并伴随卡顿与重启。
4. **第三方 MCP 蔓延灾难（MCP Sprawl）**：如果直接在宿主配置中接入 10 个下游业务 MCP 服务器（Postgres、GitHub、Docker 等），宿主 System Prompt 每次都需要携带 50~100 个庞大的 JSON Schema，急剧挤占有效注意力并显著增加模型误调概率。
5. **混杂因果归因与盲目进化（Confounded Causation）**：智能体在多变量复杂排障或多次尝试后，往往盲目把成功归因于某条不相干的规则，导致误报、偏见与迷信规则在经验库中交叉污染。

**EvoKernel 用一套“离线工作区演化引擎 + 借脑宿主 + 确定性沙盒门禁 + 固定元路由网关 + 下游 MCP 虚拟化代理”彻底解决上述问题：**

<div align="center">
  <img src="./assets/gatekeeper-shotcraft.svg" alt="EvoKernel 6 道确定性沙盒门禁" width="100%" />
</div>

---

## 📊 行业同类项目全景对比矩阵

<details>
<summary><b>📊 展开 13 维同类方案全景对比矩阵（MemGPT / Letta、Aider、直通 MCP 代理、ECC、SkillClaw vs. EvoKernel）</b></summary>

<br/>

| 对比维度 | `MemGPT / Letta` | `Aider` | 传统 MCP 代理 (直通型) | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | **🧬 EvoKernel v0.4.0 (本项目)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **核心定位** | 有状态对话 Agent 记忆数据库 | Git 驱动的终端结对编程工具 | 聚合多个 MCP 端口的直通桥梁 | 静态工程提示词与规则合集 | 后台 LLM 演化学习 Agent | **面向 AI 编程智能体的确定性自演进元内核** |
| **接入形态** | 依赖外部服务 / Postgres / 独立进程 | 独立 Python CLI 替代主流 IDE | 暴露所有子工具到 host tools/list | 静态预置 Markdown 模板 | 劫持 `/v1/chat` 本地反向代理 | **寄生型单一 Meta-MCP + <80行元规则种子注入既有 IDE** |
| **运行依赖** | 笨重依赖（Postgres、Python、向量库） | Python pip 工具链 | Node / Python 复杂依赖 | 零依赖（纯 Markdown 文本） | Python FastAPI 守护进程 | **0 依赖（纯 Node.js `>= 22.5` 原生特性：`node:sqlite`, `node:module`, `node:test`）** |
| **Prompt Cache 稳定性** | 频繁刷新全量上下文，缓存命中极低 | 随代码编辑频繁波动 | **破坏性**（暴露所有子工具，任何增删均导致前缀击穿） | 初始静态前缀偏大 | 中立 | **100% 字节级稳定：对宿主仅暴露恒定 5 个元工具原语** |
| **下游 MCP 虚拟化** | 无 | 无 | 直通暴露（50+ 工具全量倾倒至提示词） | 无 | 无 | **零缓存击穿的 FTS5 索引 + 按需 stdio JSON-RPC 动态转发代理** |
| **验证门禁机制** | 模型自评 | Git commit diff 与本地测试 | 无 | 手动人工 `/learn-eval` | 异步 LLM 评审 | **6 道确定性沙盒门禁（静态安全审查、词法去符号化、沙盒 Exit 0、BM25 去重、1500-Token 阈值、防因果混淆）** |
| **离线工作区演化** | 无 | 无 | 无 | 无 | 云端 LLM 离线评测 | **`evo optimize`：瞬态 Git Worktree 隔离运行、`inv`/`dom` 双正交演化、自动探针评测与回归熔断回滚** |
| **交付物规范消费检查** | 无 | 无 | 无 | 无 | 无 | **内置零依赖通用规范核检器（覆盖 `.xlsx`, `.docx`, `.pptx`, CSV, JSON/JSONL, Markdown）** |
| **情景记忆与防漂移** | 语义向量近似检索（重构后易幻觉） | 依赖符号跳转图谱 | 无 | 无（纯静态指南） | 无 AST 验证 | **零依赖词法/结构符号指纹（快速 AST 哈希、自动 `[STALE]` 降级、Stage-3 拓扑穿透锚点）** |
| **工作台与诊断体检** | 独立 Web + Postgres 服务 | 无 | 无 | 无 | Web 界面 | **`evo score`（<25ms 零写入体检卡）与 `evo ui`（0 依赖 EvoKernel Workbench 工业级工作台、双模态原生微窗口、SSE 实时同步、严格 CSP、单文件导出）** |
| **因果遥测与成效归因** | 无 | Git 变更行数 | 无 | 无 | 胜率计数器 | **细粒度成效记账本（`helped` / `hurt` / `contested`）与 `ERR_CONFOUNDED_CAUSATION` 防混淆** |
| **多 Agent 宿主矩阵支持** | 仅独立模式 | 仅独立模式 | 通用 MCP 客户端 | 仅限 Claude Code / Cursor | 通用反代 | **原生支持 10 款主流编码环境（Claude, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, Antigravity）** |
| **冷启动仓库基因挖掘** | 初始为空，依赖会话积累 | Git 仓库扫描 | 初始为空 | 静态合集 | 初始为空 | **`evo bootstrap`：10 秒内自动挖掘项目多栈基因与 Git 历史 Bug 修复沉淀** |

</details>

---

<a id="-零依赖原生架构"></a>
<a id="-核心架构5-个固定元工具原语"></a>
## 🧠 核心架构与深度子系统手册

EvoKernel 在 `stdio` 上仅暴露 **5 个不可变元工具原语**（`evo_search`、`evo_inspect`、`evo_run`、`evo_propose`、`evo_compact`）以确保 100% KV 缓存命中，底层配套离线 Git Worktree 演化引擎、零依赖交付物规范消费核检器、确定性因果归因与 10 大宿主无损适配器。

<details>
<summary><b>🧠 5 个固定元工具原语、下游 MCP 代理虚拟化与生命周期 Hook 路由（点击展开）</b></summary>

<br/>

### 5 个不可变元工具原语（`stdio` JSON-RPC 2.0）

| 元工具名称 | 层级 | 功能职责 |
| :--- | :--- | :--- |
| `evo_search` | **L0** | FTS5 BM25 检索规则、技能、微工具、虚拟化外部工具与情景记忆。执行实时的 Stage-2 AST 符号校验，自动将失效记忆标记为 `[STALE]`。 |
| `evo_inspect` | **L1 / L2** | 渐进披露加载器。提供故障症状/根因/方案三元组、虚拟化工具的完整 JSON Schema 以及 **Stage-3 拓扑穿透锚点**（真实代码行号、调用链与负面死胡同）。 |
| `evo_run` | **执行** | 在本地沙盒中执行微工具（`.mjs`, `.py`, `.ps1`, `.sh`）或通过 `McpProxyManager` 动态代理调用下游 MCP 服务。 |
| `evo_propose` | **演化** | 提交候选规则、技能、微工具或情景记忆，必须严格通过 6 道确定性沙盒门禁（静态安全审查、词法去符号化、沙盒 Dry-Run 自测、BM25 去重、1,500 Token 预算硬顶、因果混淆防护）。 |
| `evo_compact` | **GC** | 原子级合并零碎规则，或将已失效的 `[STALE]` 记忆归档至 `.evo/archive/`，确保核心 Token 占用严格收敛在 1,500 Token 红线内。 |

### 下游 MCP 代理虚拟化网关（`evo virtualize`）

```text
Host Coding Agent (Claude / Cursor / Copilot / etc.)
                  │
                  ▼ Fixed 5-Tool stdio Interface (100% Byte-Stable KV Cache)
         ╔════════════════════════════════════════════════════╗
         ║               EvoKernel Meta-MCP                   ║
         ║  evo_search · evo_inspect · evo_run · propose · compact
         ╚════════════════════════════════════════════════════╝
                  │                      │
        FTS5 BM25 Search          Proxy Execution (`evo_run`)
                  ▼                      ▼
        ┌────────────────────┐   ┌─────────────────────────────┐
        │ capability_fts     │   │ McpProxyManager (Pool)      │
        │ ext__postgres__... │   └──────────────┬──────────────┘
        │ ext__github__...   │                  │ stdio JSON-RPC
        └────────────────────┘                  ▼
                                 ┌─────────────────────────────┐
                                 │ Downstream MCP Servers      │
                                 │ postgres · github · docker  │
                                 └─────────────────────────────┘
```

```bash
evo virtualize --dry-run   # 演练预览：查看折叠下游 MCP 后可节省的 Token 数量
evo virtualize             # 一键将第三方 stdio MCP 服务折叠接入 EvoKernel 动态代理池
evo virtualize --restore   # 无损还原：随时将虚拟化的 MCP 配置写回原宿主配置文件
```

### 通用生命周期 Hook 路由（`evo hook <event>`）

```bash
evo hook post-tool --tool Edit --file src/core/storage.ts   # 监控文件修改、只读排障诊断 (>=10 次读取) 并召回局部规则
evo hook stop                                               # 会话结束提示沉淀经验并触发反污染脏文件告警
evo hook pre-commit                                         # 在 git commit 前拦截内部缓存与超出 1500-Token 的超额规约
evo hook mark-recovery                                      # 在命令执行报错后记录错误自愈遥测指标
```

</details>

<details>
<summary><b>🚀 离线 Git Worktree 演进优化引擎 (<code>evo optimize</code>) 与确定性因果归因（点击展开）</b></summary>

<br/>

```bash
# 同时在架构不变式 (inv) 与垂直业务域 (dom) 两个维度展开离线优化
evo optimize --dim both -k 3

# 针对指定会话轨迹与交付物核检规则进行靶向定向演进
evo optimize --trajectories session.jsonl --deliverables report.xlsx --apply
```

- **零脏状态污染**：工作树临时创建于 `.evo/.cache/optimize/worktrees/opt-...`，评测结束后自动清理。
- **正交双维度解耦演进**：跨模块架构不变式（`inv`）与业务情景记忆/SOP 手册（`dom`）正交演化。
- **多宿主真实会话轨迹解析**：原生支持 **Antigravity**、**Codex CLI**、**OpenCode** 与 **Claude Code**，候选版本一旦违反 6 道沙盒门禁即强制执行 `KEEP_BASE` 熔断回滚。
- **防因果混淆门禁 (`ERR_CONFOUNDED_CAUSATION`)**：在 SQLite 中细粒度记录 `helped`、`hurt`、`contested` 成效账本；当单次排障周期内多条能力同时命中时自动阻断单一变量抢功，要求提供 Stage-3 **拓扑穿透锚点**证明真实因果。

</details>

<details>
<summary><b>📑 零依赖交付物规范消费核检器 (<code>evo check</code> / <code>deliverable-canonical-inspector</code>)（点击展开）</b></summary>

<br/>

内置开箱即用的零依赖规范消费检验器，拦截表面正常但在下游工具中解析崩溃的交付物缺陷：

```bash
npx evo-kernel check report.xlsx          # 终端直观核检报告
npx evo-kernel check report.xlsx --json   # 面向 CI 流水线的结构化 JSON 输出
```

- **XLSX (`.xlsx`)**：纯原生 IEEE 802.3 CRC32 + ZIP Central Directory 解压引擎；正规化开首斜杠路径、剔除 `<rPh>` 拼音注音、保留 `<c .../>` 自闭合节点后的兄弟单元格，并精准拦截 `#REF!`、`#DIV/0!`、`#VALUE!`、`t="e"` 公式错误与空工作表。
- **DOCX (`.docx`) 与 PPTX (`.pptx`)**：规范提取层级标题、段落、表格矩阵与按自然序排列的 `## Slide N` 结构，拦截 `EMPTY_DOCUMENT` 与 `EMPTY_PRESENTATION`。
- **CSV、JSON/JSONL 与 Markdown (`.md`)**：RFC-4180 CSV 解析（拦截 `RAGGED_COLUMNS`）、逐行 `requiredKeys`/`strictKeys` 校验、`UNCLOSED_CODE_FENCE` 未闭合代码块检测以及代码围栏外的 `{{VARIABLE}}` 模板占位符泄漏拦截。

</details>

<details>
<summary><b>🎯 10 款主流智能体宿主适配矩阵与静默失败防御（点击展开）</b></summary>

<br/>

| 智能体 / 宿主 | 规则注入目标 | MCP 网关挂载目标 | 自动识别特征 | 隐身模式 (`.git/info/exclude`) |
| :--- | :--- | :--- | :--- | :---: |
| **Claude Code** | `CLAUDE.md` | `.mcp.json` + `.claude/settings.json` | `CLAUDE.md`, `.claude/`, `CLAUDE_CONFIG_DIR`, `~/.claude` | ✅ |
| **Cursor** | `.cursor/rules/evo-kernel.mdc` | `.cursor/mcp.json` | `.cursor/`, `.cursorrules`, `CURSOR_AGENT`, `~/.cursor` | ✅ |
| **Windsurf** | `.windsurfrules` | `.windsurf/mcp.json` | `.windsurf/`, `.windsurfrules`, `WINDSURF_DIR`, `~/.windsurf` | ✅ |
| **Cline** | `.clinerules` | `.cline/mcp.json` | `.clinerules`, `.cline/`, `CLINE_DIR`, `~/.cline` | ✅ |
| **Roo Code** | `.roo/rules/evo-kernel.md` | `.roo/mcp.json` | `.roo/`, `.roorules`, `ROO_DIR`, `~/.roo` | ✅ |
| **GitHub Copilot / VS Code** | `.github/copilot-instructions.md` | `.vscode/mcp.json` | `.github/copilot-instructions.md`, `.vscode/`, `VSCODE_PID` | ✅ |
| **Codex CLI** | `AGENTS.md` | `.codex/config.toml` | `.codex/`, `CODEX_HOME`, `~/.codex` | ✅ |
| **OpenCode** | `opencode.json` + `AGENTS.md` | `opencode.json` | `opencode.json`, `.opencode/`, `OPENCODE_CONFIG` | ✅ |
| **Gemini CLI** | `GEMINI.md` *（当 `AGENTS.md` 共存时自动跳过）* | `.gemini/settings.json` | `GEMINI.md`, `.gemini/`, `GEMINI_CLI_HOME`, `~/.gemini` | ✅ |
| **Antigravity** | `AGENTS.md` | `mcp_config.json` + `.mcp.json` | `mcp_config.json`, `ANTIGRAVITY_AGENT`, `~/.gemini/antigravity` | ✅ |

- **静默失败表面防御**：UTF-8 BOM（`0xFEFF`）自动剥离、保留注释的无损 TOML/JSON 合并、`scripts/boot-mcp.mjs` 原生 TypeScript 平滑降级、自动修复工作区与全局宿主配置中陈旧的 `_npx` 缓存路径、以及 50ms 非阻塞 Stdin 超时防护。

</details>

<details>
<summary><b>🌳 查看 ASCII 自演进能力树 (.evo/) 结构展示（点击展开）</b></summary>

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ 🧬 EvoKernel — Self-Evolving Capability Tree (.evo/)                     │
╰──────────────────────────────────────────────────────────────────────────╯
📦 Workspace: /path/to/your-repo
├── 🛡️  Rules (5 active | Core Token Budget: 132/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | hits: 4) — Every evolved Micro-Tool script must handle --self-test and exit 0.
│   ├── [SCOPED] esm-typescript-imports (154 tok | hits: 7) — Always use explicit .js extensions on relative imports in ESM TypeScript.
│   ├── [SCOPED] core-architecture-and-ast-invariants-guard (728 tok) — Dry-run compaction, comment-stripped AST matching & Git lookups.
│   ├── [SCOPED] multi-harness-config-and-proxy-isolation (906 tok) — Lossless config merge/restore, fail-closed user configs & proxy roots.
│   └── [SCOPED] workspace-isolation-and-fts5-guard (537 tok) — Isolate uninitialized fallback, parent Git detection & FTS5 search.
├── ⚡ Skills (2 verified L0/L1/L2 playbooks)
│   ├── [SOP] bug-to-guardrail-sop (hits: 3 | tags: debugging,evolution) — Standard workflow to turn a resolved root cause into a Rule.
│   └── [SOP] evo-rule-architect (hits: 2 | tags: refactor,rules) — Rule decoupling and token budget refactoring workflow.
├── 🔧 Micro-Tools (4 sandboxed scripts | Fixed Meta-MCP Routed)
│   ├── [NODE] agy-config-auditor (runs: 55 | pass: 100%) — Audits host rule budgets and memory AST symbols.
│   ├── [NODE] deliverable-canonical-inspector (runs: 18 | pass: 100%) — Zero-dep validator for .xlsx, .docx, .pptx, CSV, JSON, MD.
│   ├── [NODE] git-hotspot-analyzer (runs: 5 | pass: 100%) — Identifies top 10 frequently modified files in recent git history.
│   └── [NODE] workspace-metrics-scanner (runs: 13 | pass: 100%) — Scans file counts, LOC, and extension distribution.
└── 🧠 Episodic Memories (41 fault cases | 41 VERIFIED · 0 STALE)
    ├── [VERIFIED] audit-broken-refs-and-hook-param-fix (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] cli-help-zero-side-effect-isolation (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] codex-hooks-corrupt-file-unlink (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] generic-angle-semicolon-multiline-drift (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] ghost-workspace-resurrection-and-sqlite-handle-lock (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] harness-hook-filter-preserve-untouched-entries (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] issue-25-lexical-ast-sandbox-and-attribution-hardening (confidence: HIGH | symbols: 6/6 fresh)
    ├── [VERIFIED] issues-28-29-red-team-audit-and-cli-routing (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] multi-harness-cascaded-detection-and-reversible-teardown (confidence: HIGH | symbols: 8/8 fresh)
    ├── [VERIFIED] s0-s1-ux-trust-onboarding-and-cli-hardening (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] s1-s3-workbench-ci-and-anon-parity (confidence: HIGH | symbols: 4/4 fresh)
    └── ... (+30 additional AST-verified fault cases)
```

</details>

---

<a id="-完备测试与确定性回归验证"></a>
## 🧪 完备测试与确定性回归验证

EvoKernel 配备了基于 Node 原生测试运行器（`node:test`）的零外部依赖回归测试套件：

```bash
node ./scripts/test.mjs
```

**336 项单元与集成测试、11 个测试套件，在 ~21 秒内 100% 通过（0 失败）：**

<details>
<summary><b>🔍 查看全部 11 个验证测试套件清单（点击展开）</b></summary>

| # | 测试套件文件 | 覆盖领域 | 测试用例数 |
| :---: | :--- | :--- | :---: |
| 1 | `dist/tests/bootstrap.test.js` | 仓库冷启动与多技术栈基因挖掘测试套件 | 22 tests |
| 2 | `dist/tests/causal-telemetry-and-catalog.test.js` | 因果遥测、成效归因与动态目录测试套件 | 18 tests |
| 3 | `dist/tests/deliverable-inspector.test.js` | 零依赖交付物规范消费核检器测试套件 | 33 tests |
| 4 | `dist/tests/evo-kernel.test.js` | 核心沙盒门禁、AST 认知记忆与架构不变式测试套件 | 54 tests |
| 5 | `dist/tests/hook.test.js` | 通用生命周期 Hook 路由与管道 Stdin 非阻塞弹性测试套件 | 31 tests |
| 6 | `dist/tests/lifecycle-guard-hooks.test.js` | 门禁触发词、前置阻断与引用完整性测试套件 | 27 tests |
| 7 | `dist/tests/mcp-proxy.test.js` | 下游 MCP 代理与动态虚拟化测试套件 | 10 tests |
| 8 | `dist/tests/multi-harness.test.js` | 10 款智能体宿主多环境级联探测与安装测试套件 | 14 tests |
| 9 | `dist/tests/optimize.test.js` | 离线 Git Worktree 能力演进优化循环测试套件 | 21 tests |
| 10 | `dist/tests/score-and-ui.test.js` | 体检评分、EvoKernel Workbench 工作台与交互 API、热身与快捷指令套件 | 30 tests |
| 11 | `dist/tests/surface-audit-and-hardening.test.js` | 多宿主静默失败表面审计矩阵与 S0-S3 全链路加固测试套件 | 76 tests |

</details>

---

## 🙏 致谢与架构思想溯源

EvoKernel 是一个从零自主设计的开源工程运行时，基于 Node.js 22 原生内置模块（`node:sqlite`、`node:test`、`stripTypeScriptTypes`）以零依赖 TypeScript 编写。其系统架构融合了来自 AI 智能体社区与软件工程领域的诸多经典前沿思想：

- **渐进式披露与上下文工程**：5 个固定元工具原语（`evo_search`, `evo_inspect`, `evo_run`, `evo_propose`, `evo_compact`）与 L0/L1/L2 渐进加载模型，深度汲取了 Anthropic 关于上下文经济学、Prompt Cache 保持与技能渐进披露的设计理念。
- **离线工作区演进与正交优化探索**：`evo optimize` 的离线 Git Worktree 沙盒循环、不变式（`inv`）与领域（`dom`）正交拆解、以及规范交付物消费验证，受到最新智能体评测基准与轨迹回放优化的启发。
- **EvoKernel 原创贡献**：6 道确定性沙盒门禁（静态安全审查、词法去符号化、沙盒 `--self-test` Dry-Run、BM25 查重、1,500 Token 预算硬顶与因果防混淆）、基于 Git 拓扑的 3 阶段 AST 防漂移认知记忆（`VERIFIED` / `OTHER_BRANCH` / `STALE`）以及 10 大宿主无损适配矩阵，均为 EvoKernel 的自主原创研发。

---

## 📄 开源协议

遵循 [MIT 许可证](LICENSE)。
