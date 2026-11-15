# AI-Drama-Studio：代码调试入口

本文件用于快速理解当前代码及验收边界。请结合当前分支/提交中的源文件阅读；文档中的历史验收结果不是任何新修改的自动验收结论。

## 当前开发方向：自有模型创作与规则库

最新0.6.0见[视频独立验收](video-v07-acceptance.md)：252/252回归，新增当前图片→即梦视频准备→原ID查询/下载→候选检查选用的完整隔离流程。源码`src/video-{store,jobs,media}.mjs`、`src/dreamina-video.mjs`、`public/video.*`。真实提交硬关闭、未消耗积分；direct未登录/canvas已登录、费用未知/原生静音不支持分别展示。测试MP4不是真实即梦生成。原500文件及原图像1/1保持，自动出图及hook不扩展。[下次真实验收方案](video-real-acceptance-plan-v07.md)列实际素材/参数及建议100积分上限，未获授权且报价未知不能提交。

历史0.5.1见[无新增生成验收](image-contract-v061-acceptance.md)：215项回归；事件期hook故障中断、分层附件证据、append-only诊断与四项状态。实际`inputImages`非必填且无default，缺省保持未知；若存在只证明该图像请求成功本地读取，不证明远端使用或画面符合。原失败任务与原1/1不改，严格单次无法保证，自动入口继续关闭。入口新增`src/codex-image-watchdog.mjs`、`src/image-evidence.mjs`、`src/image-diagnostics.mjs`；原始回执仍在原data，不根据夹具升为真实成功。

历史软件0.5.0以[单图独立验收](auto-image-acceptance.md)为准：修复参考审核失效传递和旧包下载门禁，增加持久化单镜头任务、去重、原绑定及失败原图保留。真实Codex仅调用一次、产出一张图片，但私有hook失败且事件缺少参考附加证明，自动验收未通过，当前自动提交关闭。手工出图、导入和检查仍可用。新增入口为`src/image-jobs.mjs`、`src/codex-image-runner.mjs`、`src/codex-image-guard.mjs`、`src/image-decoder.mjs`；[官方契约和实际缺口](codex-image-contract.md)必须一起阅读。不能把隔离成功、功能标志或已保留原图当作自动接入成功。

软件0.4.0新增 [分镜图片工作台](image-workbench.md) 和 [官方图像能力只读核查](image-tools-check.md)：`src/image-store.mjs`、`src/image-files.mjs`、`src/image-capabilities.mjs`、`public/images.*`。只执行手工导出、实际文件导入和人工选用，未接自动出图。`src/entity-provenance.mjs`修复模型新增实体来源自报漏洞，输入证据与快照分别核对；历史缺证据记录保持待确认，原文不改。测试图片不证明真实AI生成，最新验收以本分支独立记录为准。

[三手册与Huobao整合说明](creative-knowledge-v04.md)更新目标路线：自有ChatGPT／Codex负责剧本、分镜和独立审阅，图像及即梦画布／无对白视频单独接入。既有即梦文字工具仍可选，其报价缺口不应阻断未来的Codex文字流程。下文历史“即梦剧本→即梦分镜”路线不再作为默认开发方向。

本分支工作台0.3.0将既有规则核心接入 `public/creative.*` 和HTTP路由，提供本机Codex剧本、分镜候选、独立审阅与人工采用。后端见 `src/creative-jobs.mjs`、`src/creative-store.mjs`、`src/creative-runner.mjs`；[使用与边界](creative-workbench.md)。15位导演、17个作品级预设和90条显式扩展仍由 `knowledge/creative/` 提供。即梦文字费用不会阻断Codex；正式四岗位guard/账本与媒体保持未接入。验收以本分支独立记录为准，不能复用历史成功。

## 首次真实业务验收（0.2.1）

[本轮真实记录](first-business.md)：独立测试画布已查重创建、访问校验并绑定，目标30秒；即梦生成仍因费用缺口未提交，待提交任务与request-id已保留。真实Codex对非即梦来源手工样例审阅一次，报告成功落盘但内容结论REVISE，5项问题，不能算稿件通过或即梦生成成功。[官方费用证据](first-business-fees/fees-report.md)已确认按产出字数计费且无总价预检；缺当前账号每字费率、CLI免费凭证及可确认总额，不按免费调用。

[报价模块](pricing.md)现支持真实依据的FREE/CREDITS/CNY和各自预算，官方有效期未知时明确记录，不虚构官方编号或兑换率。新增72项完整测试通过，历史0.2.0结果在下文保留供区分。

## 第二阶段最新状态（0.2.0历史验收）

当前0.2.0新增[剧本页面、任务与独立审阅](stage2.md)，保留立项和备份修复。jimeng-novel认证已实际成功；任务适配和隔离测试完成，但生产报价为“费用待确认”，本轮未实际生成剧本或运行新增真实审阅。历史验收记录不作为本轮生成成功证据。

新增源码：`src/script-store.mjs`（输入、版本与Hash）、`src/scripts.mjs`（费用/任务/恢复）、`src/novel.mjs`（官方CLI）、`src/script-review.mjs`（独立审阅）、`public/script.*`（剧本页）。

## 本轮修复与检查

2026-11-15新增[候选备份修复](backup-fix-2026-11-15.md)：完整说明与来源一次写入，新增回归后共9项测试通过；原有项目/任务/素材哈希保持一致。另已核实官方独立 `jimeng-novel 1.0.6` 的[AI大纲/单集剧本生成契约](jimeng-cli-audit-2026-11-15/script-cli-report.md)，但没有提交任务或接入工作台；专用Agent改稿/诊断仍待官方确认。本轮两个现有CLI的[实际授权结果](dreamina-auth-2026-11-15.md)独立记录，不套用旧登录快照。

## 当前产品范围

AI-Drama-Studio 是 Windows 本地运行的中文 AI 短剧软件，使用 MIT 许可。当前版本为 `0.2.0`，包含故事立项以及第二阶段剧本输入、任务适配、人工版本与独立审阅工作台。

当前流程是：填写构思和项目要求 → 通过本机 Codex 扩写 → 审阅候选 → 采用并人工编辑 → 保存项目。后续完整路线是：即梦剧本 → Codex 审阅 → 即梦分镜 → Codex 检查 → 画风和预算 → 即梦画布与无配音视频 → 配音、字幕和剪辑 → 成片导出。界面显示的后续步骤不代表功能已经接入。

公开仓库提供源代码、测试和开发文档。它不会把本机的 `http://127.0.0.1:4317` 服务发布到互联网，也不会上传 `data/` 中的个人项目、任务、参考素材或认证信息。阅读 GitHub 代码不能直接操作开发者电脑或查看其本地项目。

## 已实现与实际验证

- 中文项目列表、新建、编辑与持久化，字段包括名称、故事构思、时长、横竖屏、画风、参考素材和人民币预算上限；时长默认30秒。
- 通过官方 `codex exec` 接口调用本机真实 Codex，以 JSONL 事件记录任务，以 Schema 约束六段说明：故事梗概、背景、人物关系、核心冲突、情绪发展和结局。
- 原始构思独立保存，结果区分保留的用户要求与 AI 补充。候选只有在用户采用后才进入编辑稿。构思变化后的旧候选不能覆盖新要求。
- 手动保存使用 revision 检查；过期版本返回409。项目文件采用临时文件、fsync、上一版备份及 rename 保存，损坏原件保留并报告。
- 参考素材保存在本地受控目录，每个文件最多25MB，每项目最多20个。本阶段模型只接收名称、类型与大小，不读取或分析附件正文。
- 已在真实浏览器完成「创建项目 → 真实 Codex 扩写 → 采用 → 人工修改保存 → 服务重启恢复」；七项 Node 集成测试通过，含附件上传下载和服务重启后的字节一致性。详细证据见[验收记录](validation.md)。

一次真实扩写曾因 `tls handshake eof` 失败，软件显示并保存真实错误，没有用预设说明替代。随后另一笔真实扩写成功。第二次成功不能证明网络问题已永久修复；每次调用以实际终态为准。

## 尚未实现或确认

- 官方剧本命令适配已完成，但当前费用未知、真实提交被门禁阻止；自动分镜、媒体生成、配音、字幕、剪辑和导出尚未实现。
- 验收机器上的两个即梦 CLI 已安装但未登录。帮助列出的生成命令、画布文本节点和导演台能力，不能等同于已验证的自动编剧/自动分镜接口。
- FFmpeg/FFprobe 已实际执行版本检查，真实媒体制作流程尚未验证。
- 预算上限是制作计划字段，不会限制 Codex 账号用量。
- 暂无多用户远程服务、桌面安装包、项目删除或通用导入恢复界面。Windows 已验证，其他平台未实测。

## 建议阅读顺序与文件索引

| 问题 | 先读文件 |
| --- | --- |
| 安装、启动与配置 | [README](../README.md)、[启动脚本](../scripts/start.ps1)、[命令入口](../start.cmd)、[package.json](../package.json) |
| 全局结构、接口与数据边界 | [架构说明](architecture.md)、[HTTP 服务](../src/server.mjs) |
| 项目保存、revision、附件与候选保护 | [存储模块](../src/store.mjs)、[集成测试](../tests/core.test.mjs) |
| Codex 启动、认证、状态、提示词与结果校验 | [Codex 任务模块](../src/codex.mjs)、[工具发现模块](../src/tools.mjs) |
| 工具安装检测与接口能力 | [工具检测记录](tool-inspection.md)、[实际帮助证据](tool-help/) |
| 页面交互、异步保存与任务轮询 | [前端逻辑](../public/app.js)、[页面](../public/index.html)、[样式](../public/styles.css) |
| 浏览器复核 | [浏览器测试](../tests/browser-smoke.mjs)、[CDP 工具](../tests/cdp.mjs)、[历史复核结果](restart-check.json) |
| 下一阶段的实现范围 | [后续任务](next-stage.md)、[开发记录](development-log.md) |

## 在本地启动与验证

要求 Node.js 22+。没有 npm 运行依赖、独立数据库或构建步骤。

```powershell
# Windows 启动；无独立Node时可发现已安装Codex运行时
.\scripts\start.ps1

# 只检查运行时，不启动服务
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1 -CheckOnly

# 本机Node已在PATH时
node .\src\server.mjs

# 不发起模型或媒体生成的隔离集成测试
node --test tests/core.test.mjs
```

默认地址为 `http://127.0.0.1:4317`，数据目录为仓库下的 `data/`。端口和数据目录可用 `PORT`、`DATA_DIR` 配置；原生工具路径可用 `CODEX_BIN`、`DREAMINA_BIN`、`DREAMINA_CANVAS_BIN`、`FFMPEG_BIN`、`FFPROBE_BIN` 覆盖。启动脚本另支持 `NODE_BIN`。

真实 Codex 任务必须有安装和认证，调用失败不能作为成功。`node tests/browser-smoke.mjs --expand` 和 `node scripts/verify-real.mjs --run-codex` 会显式发起真实模型请求，可能使用账号额度；它们不是普通单元测试。`--restore` 依赖本机已有验收记录，克隆公开仓库后不能假定记录存在。

## 向网页版 ChatGPT 提供问题

将仓库公开地址、本文件链接和相关源文件链接一起提供。若页面无法读取，应粘贴相关代码或上传文件，而不是把「已给出仓库地址」当作模型已经读完整个仓库。需要固定版本时，使用对应提交的文件链接，避免调试期间分支继续变化。

可复制以下模板：

```text
请先阅读这个 AI-Drama-Studio 仓库的 docs/CHATGPT_CONTEXT.md，
再读取我列出的相关源文件。请说明实际读到的分支或提交，
以及无法读取的文件，不要把未接入的后续阶段当成现有功能。

仓库链接：<公开仓库地址>
本次版本：<分支或提交SHA>
相关源文件：<文件链接>

问题现象：<实际结果>
预期行为：<希望发生什么>
复现步骤：<步骤>
环境：<Windows、Node、Codex版本>
错误：<已去除密钥、token和私人故事的日志>

请给出有代码依据的原因、最小修改建议和验证方式。
缺少证据时请明确指出；不要编造运行结果或本机文件内容。
```

这里没有设置自动同步、远程控制或自动访问本地数据的能力。后续每次代码改变后，应提交并推送相应版本，再提供最新链接。
