<div align="center">

# 🧬 EvoKernel

### 面向 AI 编程智能体的「确定性自演进元内核」

**告别越写越乱的静态 `.md` 规则文件。告别击穿 Prompt Cache 的海量 MCP 进程。**  
*80 行 L0 元规则种子 · 单一固定签名元 MCP 网关 · 4 道本地确定性沙盒门禁 · 0 第三方依赖*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(零供应链风险)-brightgreen?style=flat-square)](#零依赖原生架构)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20字节级稳定-ff6b6b?style=flat-square)](#为什么采用固定-5-工具的元-mcp-网关)
[![Harnesses](https://img.shields.io/badge/Claude%20Code%20%7C%20Cursor%20%7C%20Antigravity%20%7C%20Codex%20%7C%20Gemini-supported-8A2BE2?style=flat-square)](#60-秒快速开始)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

---

## ⚡ 为什么大多数“自我进化规则/技能”项目在 30 次对话后就会崩溃？

在使用 Claude Code、Cursor、Antigravity 或 Codex 时，传统的“自进化”方案普遍死于以下三个工程陷阱：

1. **规则膨胀与上下文腐败（Context Rot）**：每次踩坑就往 `CLAUDE.md` 或 `.cursorrules` 追加一条 `Never do X`，很快就会变成上万 Token、前后矛盾的“垃圾场”。一旦常驻规则超过 ~1,500 Tokens，大模型的 `Lost-in-the-Middle` 效应会令旧规则大面积失效。
2. **“自评自改”的幻觉固着（Worker Grading Its Own Homework）**：让同一个上下文的 LLM 不经沙盒验证直接写全局脚本或技能，极易把包含语法错误、硬编码个人路径（如 `C:\Users\Alice\...`）的废脚本永久写入配置。
3. **动态 MCP 引发的 Prompt Cache 雪崩**：如果“动态进化 MCP”意味着不断注册新的一级 MCP 工具并触发 `list_changed`，每次工具列表变化都会**直接击穿 Claude / DeepSeek 的前缀 KV 缓存（Prompt Caching）**，导致 Token 成本暴涨 5~10 倍。

**EvoKernel 用一套“借脑宿主 + 本地确定性编译门禁 + 固定元路由网关”彻底闭环上述问题：**

```text
[修复棘手 Bug / 用户纠正 / 编写超过 15 行的通用临时脚本]
                     │
                     ▼
        ┌─────────────────────────┐
        │   evo_propose (MCP)     │  ◄── 100% 借脑宿主当前模型（无需额外配置任何 API Key！）
        └────────────┬────────────┘
                     ▼
  ╔══════════════════════════════════════╗
  ║  4 道本地确定性编译门禁 (Gatekeeper) ║
  ║  1. 静态安全与结构审计               ║  拦截硬编码绝对路径、明文密钥与 rm -rf 高危指令
  ║  2. 语法预检与沙盒 --self-test 实跑  ║  隔离沙盒执行脚本自测，退出码必须为 0 方可入库
  ║  3. FTS5 BM25 相似度查重             ║  拦截重复造轮子，强制升级旧资产而非盲目新建
  ║  4. 1,500 Token 硬预算与强制 GC      ║  超限时拒绝写入，逼迫模型先调 evo_compact 合并瘦身
  ╚══════════════════╤═══════════════════╝
                     ▼
        ┌─────────────────────────┐
        │ Git 透明文件树 (.evo/)  │  ──► 经固定 5 工具 Meta-MCP 动态路由（0 缓存失效、0 重启）
        └─────────────────────────┘
```

---

## 📊 与 GitHub 同类高星项目的核心差异对比

| 对比维度 | `affaan-m/ECC`<br>*(27.9w ⭐)* | `AMAP-ML/SkillClaw`<br>*(2.7k ⭐)* | `lsdefine/GenericAgent`<br>*(1.4w ⭐)* | `mksglu/context-mode`<br>*(2.9w ⭐)* | **🧬 EvoKernel (本项目)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **宿主接入形态** | 预装 311 个静态技能包 | 劫持 `/v1/chat` 本地代理 | 独立 TUI/Web 运行时 | 沙盒压缩输出 MCP | **寄生型单一 Meta-MCP + 80行元规则种子** |
| **额外 API Key 依赖** | 无 | 强依赖后台演进模型 Key | 强依赖独立模型 Key | 无 | **零额外 API Key（100% 借脑宿主模型）** |
| **MCP 动态能力自生长** | 仅静态配置 | 不支持（仅改写 `.md`） | 仅内部 `code_run` | 仅一次性沙盒脚本 | **临时脚本经沙盒自测自动晋升为持久微工具** |
| **Prompt Cache 友好度** | 预置过多易稀释注意力 | 无直接影响 | 独立上下文 | 压缩工具输出 | **固定 5 个元工具签名，100% 保住前缀缓存** |
| **防毒化/防膨胀机制** | 手动触发 `/learn-eval` | 后台 LLM 异步合并 | 直接覆写文件 | 会话结束即清空 | **4 道确定性脚本门禁 + 1,500 Token 硬上限 GC** |
| **首分钟冷启动体验** | 通用静态大合集 | 空库等待对话积累 | 仅 9 个原子工具 | 空库等待索引 | **`evo bootstrap` 10秒挖掘仓库与 Git Fix 历史** |

---

## 🚀 60 秒快速开始

> **环境要求**：Node.js `>= 22.5` 或 `24+`（基于 Node 原生内置 `node:sqlite` 与 `node:module` 原生 TypeScript 剥离器构建 —— **0 第三方 npm 依赖，无需 `npm install` 漫长等待**；Windows 下推荐 `>= 22.16` / `22.23 LTS` 或 `24+` 以启用原生 SQLite FTS5，早期 `v22.5–v22.14` 版本会自动无缝降级至内置 JS BM25 检索引擎）。

```bash
# 1. 克隆并构建（耗时 <50ms，零外部依赖）
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 2. 自动探测并注入 L0 元规则种子与 Meta-MCP 到 Claude Code / Cursor / Antigravity / Codex / Gemini
#    （可选：--stealth 仅写入本地 .git/info/exclude；--targets agents 或 --targets auto 过滤目标宿主）
node ./dist/cli/index.js init

# 3. 冷启动基因提取：10 秒扫描当前仓库配置与 Git 历史 fix 记录生成初始规则与微工具
node ./dist/cli/index.js bootstrap

# 4. 查看自演进能力树与 ROI 遥测账本
node ./dist/cli/index.js tree
node ./dist/cli/index.js stats
```

---

## 🧠 5 个固定元 MCP 工具契约（永不击穿 Prompt Cache）

| 元工具名 | 披露层级 | 核心职责 |
| :--- | :--- | :--- |
| `evo_search` | **L0 摘要层** | 基于 SQLite FTS5 (BM25) 毫秒级检索 `.evo/` 下的规则、技能与微工具，仅返回 `<30 tokens` 的一句话摘要、命中次数与沙盒通过率。 |
| `evo_inspect` | **L1 / L2 详情层** | 渐进式按需披露。仅在确认需要时读取某项能力的 `L1`（输入输出 JSON Schema 契约）或 `L2`（完整 SOP 步骤或脚本源码）。 |
| `evo_run` | **沙盒执行层** | 在受控子进程沙盒中直接调度执行 `.evo/tools/<id>/` 下的 `.mjs` / `.py` / `.ps1` / `.sh` 微工具，自动截断超长输出并记入 ROI 账本。 |
| `evo_propose` | **门禁演进层** | 提交新提炼的 Rule、Skill 或 Micro-Tool 候选，同步触发本地 4 道 Gatekeeper 确定性检查，通过后原子落盘并实时同步至各宿主。 |
| `evo_compact` | **垃圾回收层 (GC)** | 当常驻核心规则触及 1,500 Token 红线时，将多条碎片化旧规则归档至 `.evo/archive/` 并原子替换为合并后的高密度规则。 |

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
