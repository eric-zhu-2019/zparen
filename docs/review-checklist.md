# ZParen 自动化评审检查清单

拟定 2026-11-07，基于 2026-11-07 草稿，逐条对照了仓库现状。

目的：把反复出现的评审意见变成自动检查。Agent 交付前自己跑、自己修。人只看报告、diff 和标 [人审] 的条目。

## 规则

- 只有能自动判 pass/fail 的意见进清单。纯品味和产品取舍留在人工评审。
- [自修]：挂了由 agent 改到通过。[人审]：机器只报警，改法由人定。
- 每条写明：检查方式、跑在哪层、现状。现状不是"通过"的条目，先补齐再开门禁，否则门禁第一天就是红的。

## 三层

| 层 | 耗时 | 入口 | 现状 |
| --- | --- | --- | --- |
| Pre-commit | 秒级 | `.githooks/`（`git config core.hooksPath .githooks`） | 没有 |
| CI | 分钟级 | 新建 `.github/workflows/ci.yml`，push 到 main 和每个 PR 都跑 | **没有**。`scripts/verify.sh` 只在打 tag 发版时由 `release.yml` 跑。PR #5 合并时没有任何检查 |
| Agent pre-flight | 约 5 分钟 | 新建 `scripts/preflight.sh` = pre-commit 全部 + `verify.sh` + 本清单其余可本地跑的条目，输出下面的报告 | `verify.sh` 已有：Rust、vitest、55 个 e2e |

CI 用 `macos-15`（要 SBCL 和 WebKit）。注意 macOS runner 排队：v0.1.10 的 sign job 曾因 "not acquired by Runner" 被取消。

### Agent 交付报告格式

```
预检：scripts/preflight.sh，exit 0
挂过的条目：A2 clippy（3 条）→ 已修，见 <commit>
[人审] 报警：C12 深色 debugger 截图差 2.1%（阈值 1%），图在 e2e/.results/…
行为变化：<逐条列出，没有写"无">
```

## A. 代码门禁

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| A1 | `cargo fmt --all --check` | pre-commit, CI | **606 处差异**。先单独提交一次全仓格式化（纯格式，不改行为），再开门禁 | [自修] |
| A2 | `cargo clippy --workspace --all-targets -- -D warnings` | CI | **15 条警告**（zparen-core lib 11，zparen lib 1，两个 assistant 测试各 1…）。先清零 | [自修] |
| A3 | `cargo test` 全绿，`#[ignore]` 数量不比 main 多 | CI | 全绿已由 `verify.sh` 保证（每个测试二进制 300 s 上限，单线程防 fasl 竞争）。ignore 计数没有 | [自修] |
| A4 | `tsc --noEmit`（已开 strict、noUnusedLocals、noUnusedParameters）+ `vitest` | CI | 已在 `verify.sh` | [自修] |
| A5 | ZParen 自带 Lisp 零警告：`resources/lisp/*.lisp` 在**一个** `with-compilation-unit` 里加载，warning 和 style-warning 都算失败 | CI | 0 warning，2 style-warning：`zparen.lisp` 引用 `tests.lisp` 里的 `failure-lines`、`run-system-tests`，是跨文件前向引用，放进同一个 compilation unit 即消失。**检查要放独立脚本，不能放进 `build-core.lisp`**：core 在用户机器上构建，换个 SBCL 版本多一条警告就会让用户的 app 起不来 | [自修] |
| A6 | 干净 SBCL 冒烟 | CI | 草稿写"load 整个 ASDF 系统"，但 ZParen 自己的 Lisp 不是 ASDF 系统。已覆盖：Rust ops 测试每次用全新 SBCL 构建 core。e2e 用模板新建 Lisp 项目并加载。还缺：`examples/plugins` 在干净 image 里加载 | [自修] |

ESLint 未安装。暂不引入：tsc strict 已覆盖大部分。等某条评审意见确实需要某条 lint 规则（例如 `react-hooks/exhaustive-deps`）时再按规则引入。

## B. 跨层契约

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| B7 | 前后端协议一致：重新生成 ts-rs 类型后 `git diff --exit-code src/protocol` | CI | 真正的契约不在 Tauri command（只有 `rpc`、`quit`、`install_update`、`set_recent_projects` 4 个），而在 `Request`/`Response`/`Op` 类型，由 ts-rs 生成到 `src/protocol`。`verify.sh` 会重新生成，但**不比对**，所以忘了提交生成结果不会挂。另加一条 vitest：`generate_handler!` 列表 = TS 侧 `invoke("…")` 名字集合 | [自修] |
| B8 | MCP 工具三方一致：`crates/zparen-core/src/tools.rs` 的工具名和参数 = `docs/assistant.md` 的工具表 = MCP 服务说明文本 | CI | 16 个工具今天全部写在 `docs/assistant.md` 里。这条是防退化 | [自修] |
| B9 | 改名残留：`git grep -i -E 'zenlisp\|ZENLISP_'` 零命中，白名单除外 | pre-commit | 白名单（都是有意的迁移代码）：`crates/zparen-core/src/session.rs`（旧文件夹迁移），`src/renamed.ts`，`resources/lisp/plugins.lisp`（旧包名 nickname），`scripts/release.sh`（旧环境变量名），`src-tauri/src/lib.rs`（调用迁移），e2e 测试 "settings saved when ZParen was ZenLisp"。旧仓库 URL：待填，今天的 `git grep` 没有命中 | [自修] |
| B10 | 版本号一致：`src-tauri/tauri.conf.json` = `package.json` = `src-tauri/Cargo.toml` = `Cargo.lock` 里的 zparen = tag | pre-commit, release | `release.yml` 只比对 tag 和 `tauri.conf.json`。现在三处都是 0.1.10。内部 crate（zparen-core、zparen-dev、parinfer-wasm 都是 0.1.0）不参与 | [自修] |

## C. 产品一致性

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| C11 | 双窗格高亮一致：同一文件在左右两个编辑窗格（以及其他显示源码的地方）打开，逐行比对 token 的 class 序列 | CI (e2e) | 没有。来源：2026-11-02 Reddit 报告，square 在右窗格被高亮、主编辑器函数名渲染不同（据用户转述，本文未复现）。**用 DOM 比对，不用像素比对**：像素比对会被光标、选区和字体渲染干扰 | [自修] |
| C12 | 主题回归：编辑器、REPL、Inspector、调试器 × 浅色/深色，Playwright `toHaveScreenshot` 对基线，差异超阈值报警 | CI | 没有基线。e2e 目前截 43 张图到 `e2e/.results`，只存不比。基线与平台绑定（macOS WebKit），CI 和本地要同平台。更新基线必须人批准 | [人审] |
| C13 | 对外宣称核验：README、`site/`、帖子里每条功能宣称，各配一条核验命令（SBCL 版本、Vim、课程、下载链接指向最新 release…） | release | 没有。来源：10 月的帖子还写 build-from-source，v0.1.8 已发布公证版，文案过期半个月 | [人审] |
| C14 | 键位文档与实现一致：解析 `docs/getting-started.md`、`docs/editing.md` 里的键位表，每行的键和动作都要在 `src/keys.ts` 的 `bindings` 里存在 | CI (vitest) | 应用内快捷键列表（⇧⌘/）已经从 `bindings` 生成，文档表格是手写的 | [自修] |
| C15 | 预期中的失败不写进 REPL：新建普通项目，依次打开 Learn、Docs、Assistant、Inspector，REPL 里没有错误行 | CI (e2e) | 2026-11-07 修过一次：Learn 在非课程项目里往 REPL 写 "this is not a course project"。新的右侧面板 tab 测试已带这条断言，待推广到其他面板 | [自修] |

## D. 安全

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| D16 | Secret 扫描：gitleaks 扫全部历史（CI）和暂存区（pre-commit）。另加文件名规则：受跟踪文件不得匹配 `*.p12 *.p8 *.pem *.key .env*` | pre-commit, CI | 没有。`cert.p12` 在仓库根目录，已加入 `.gitignore`，这条规则防它被强制加入 | [自修] |
| D17 | MCP 只听本机：`serve()` 返回地址是 loopback；`Host` 不是本机时拒绝；缺 token 时拒绝 | CI | 代码绑定 `Ipv4Addr::LOCALHOST`（`mcp.rs:96`），默认端口 7337（`mcp.rs:199`），有 Host 检查（`mcp.rs:144`）。`tests/mcp.rs` 有 4 个测试，没有绑定地址断言。另外两条是否已覆盖，落地时核对 | [自修] |
| D18 | 凭证不外泄：用假 key（如 `sk-test-LEAKCHECK`）跑一遍助手请求，包括出错路径。然后在数据目录（保存的对话）、REPL 记录和 Help ▸ Report 复制出的诊断信息里搜这个字符串，零命中 | CI | 草稿写"请求/响应日志打码"，但 `assistant.rs`、`agent.rs` 现在**不记**请求/响应日志。真正可能泄露的是上面三处。mock 服务器在 `tests/assistant.rs` 已有 | [自修] |

## E. 发布

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| E19 | 签名和公证：`codesign --verify --deep --strict`，`spctl -a -vv`，`xcrun stapler validate`，任一失败就不发版 | release | `release.yml` 已经 staple 和 validate。但缺 App Store Connect key 时**只给 notice，照样发一个未公证的版本**。改成失败，除非显式设置 `ALLOW_UNNOTARIZED=1` | [自修] |
| E20 | Release 资产完整：发布后自动 `gh release view`：dmg、`ZParen.app.tar.gz`、`latest.json` 都在；`latest.json` 版本 = tag，签名非空；下载链接返回 200，大小一致 | release（新 job） | 没有。v0.1.10 是手工验的 | [自修] |
| E21 | 干净机冒烟：没有开发环境的 macOS VM（如 tart）下载 dmg → 启动 → 新建项目 → REPL 求值 `(+ 1 2)` 得 3 | release | 没有。失败形态多，先只报警 | [人审] |

v0.1.10 的教训已经修掉：build 产物保留期从 1 天改为 7 天，所以审批晚了 sign job 也找得到产物。

## F. 性能预算

| # | 检查 | 层 | 现状 | 标记 |
| --- | --- | --- | --- | --- |
| F22 | 冷启动：启动到窗口出现、启动到 "Lisp running" 两个数分开测。core 已缓存和首次构建 core 两种情况分开记。比基线慢 20% 报警 | CI | 没有测量。先量基线，再定预算 | [人审] |
| F23 | 大文件：打开 1 MB Lisp 文件到高亮完成的时间，加上在文件末尾打字的延迟 | CI (e2e) | 没有测量 | [人审] |

## Pre-commit 额外条目

| # | 检查 | 现状 | 标记 |
| --- | --- | --- | --- |
| P1 | 提交信息里没有 "Generated with Claude Code" 和 "Co-Authored-By: Claude"（commit-msg hook）。来源：提交和 PR 风格规定 | 靠记忆规则，没有 hook | [自修] |

## 清单怎么长大

清单本身不重要，重要的是它怎么长大。每次评审打回一个问题，先问：这个问题能写成自动判定吗？

- 能：当场加一行。写清检查方式、层、[自修] 还是 [人审]、来源。同类问题以后不用再说第二遍。
- 不能：留在人工评审，不硬塞。清单短而可信，比长而没人跑强。

例子：2026-11-07 的两次修复，一条能进清单，一条不能。

- 能进：C15。"预期中的失败不写进 REPL" 能写成 e2e 断言。
- 不能进："保留旧行为，行为变化要报告"。无法自动判定，留在人工评审，靠报告里的"行为变化"一栏。

新条目模板：

| # | 检查 | 来源（哪次评审/反馈） | 层 | 判定 | 标记 |
| --- | --- | --- | --- | --- | --- |
| 24 | | | | | |

## 落地顺序

1. **先建 CI**（`ci.yml`，PR 和 main 都跑 `verify.sh`）。没有它，A、B 两组都没有地方跑。
2. **第一批，都是一次性清理加现成工具**：A2 清 15 条 clippy，A1 一次格式化提交，A5，B7，B9，B10，D16，P1。
3. **第二批，都是真咬过的问题**：C11、C15、E19（未公证会静默发版）、E20、C14、D18。
4. 其余（C12、C13、E21、F22、F23）要先搭基线或环境，按评审撞到的频率逐条加，不求一次凑满。
