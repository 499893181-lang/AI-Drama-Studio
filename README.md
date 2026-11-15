# AI-Drama-Studio

Windows 本地中文 AI 短剧工作台，MIT 开源。当前0.2.1保留故事立项，新增剧本输入、任务适配、不可变稿件版本与Codex独立审阅。

公开仓库：[499893181-lang/AI-Drama-Studio](https://github.com/499893181-lang/AI-Drama-Studio)。网页版调试先读[调试入口](docs/CHATGPT_CONTEXT.md)与[源码索引](llms.txt)。GitHub提供代码和文档；本机服务、个人项目和认证不会随仓库公开。

## 启动

双击 `start.cmd`，或执行：

```powershell
.\scripts\start.ps1
# 已有Node时也可
node .\src\server.mjs
```

打开[故事立项](http://127.0.0.1:4317)或[剧本工作台](http://127.0.0.1:4317/script.html)。需要Node.js22+，没有npm运行依赖或独立数据库。启动器支持 `NODE_BIN`、PATH和已安装CodexPrimaryRuntime，不下载程序或修改全局PATH。

## 当前功能

- 故事立项：项目列表、默认30秒、横竖屏、画风、参考素材、预算、真实Codex扩写、人工修改、revision冲突保护与重启恢复。候选采用一次写入正文与来源，备份保留旧人工稿。
- 剧本输入：从当前保存的创作说明确定性整理大纲/单集参数，显式绑定并只读核验真实即梦画布与空间ID，不自动创建画布。
- 即梦适配：官方 `script outline`、`script episode`、`script result`，提交前保存幂等键，保存thread/run和原始回执。中断后查询原任务，缺ID时禁止猜测重提。只有真实终态、有效ID和本次CLI导出的非空完整正文才提供候选。
- 稿件版本：分别查看大纲、即梦候选、人工稿，编辑保存为新版本，保留历史并可切换活动版本。没有已验证的即梦Agent定向改稿接口，人工保存不冒充Agent修改。
- 独立审阅：用户点击后新开真实Codex会话，检查用户要求、人物动机、逻辑、时长、连续性和制作难度，报告独立保存。输入或活动稿变化后旧稿/报告显示需要复核。

**费用边界：官方说明剧本按产出字数计费且不支持总价预检，当前仍缺本账号CLI每字费率或免费凭证，因此显示“费用待确认”，服务端禁止提交。** 报价模块支持有真实依据的免费、积分和人民币，分别记录渠道、来源、单位、条件与有效期；积分和人民币分别设预算，不推汇率，不造官方quoteId。 准备任务仅保存输入与request-id，不消耗生成额度。项目人民币预算、账号余额及图像/视频节点估价均不能代替剧本报价。隔离测试中的已知零费用夹具不是生产价格。

最新首次业务验收已创建并验证独立测试画布、绑定30秒测试项目，并对明确标为非即梦来源的既有手工测试文本完成一次真实Codex独立审阅，结论REVISE（5项问题）。费用未知，仍未提交即梦大纲或剧本生成。详见[首次真实业务验收](docs/first-business.md)和[费用依据](docs/first-business-fees/fees-report.md)。图片、视频、配音、字幕和剪辑尚未接入。

## 配置jimeng-novel

使用已核实的官方Windows x64发行ZIP，保留exe与配套runtime完整结构：

```powershell
.\scripts\setup-novel.ps1 -ArchivePath 'C:\实际路径\jimeng-novel-1.0.6-windows-amd64.zip'
.\scripts\setup-novel.ps1 -CheckOnly
```

工具保存在Git忽略的 `.local/jimeng-novel-1.0.6/`。也可将 `JIMENG_NOVEL_BIN` 指向有相邻runtime的原生程序绝对路径。适配器只读检查版本和登录状态，不会自动发起授权。需要登录时，在本人终端执行该完整发行目录的 `jimeng-novel login`，完成本次官方网页授权后用 `status -j`核实，不复用过期挑战。

Codex继续使用本机认证与模型配置；未认证时执行 `codex login`。环境变量包括 `PORT`、`DATA_DIR`、`NODE_BIN`、`CODEX_BIN`、`JIMENG_NOVEL_BIN`，以及原有即梦/FFmpeg路径配置。真实画布ID来自即梦服务，本工作台项目UUID不能代替。

## 数据与验证

默认data目录仍在项目根目录，原项目不迁移。新增 `data/scripts/`保存输入/绑定/版本，`data/script-jobs/`保存即梦任务和回执，`data/script-reviews/`保存独立审阅；私有运行文件在 `data/runtime/`。停止服务后备份整个data目录。个人数据、授权材料、完整工具包、缓存和媒体均不进Git。

不消耗真实模型或生成额度的验证：

```powershell
node --test tests/*.test.mjs
node tests/script-browser-smoke.mjs
```

浏览器测试使用明确隔离夹具与临时数据，需要本机Chrome/Edge；其假审阅报告不能算真实模型结果。第一阶段 `tests/browser-smoke.mjs --expand` 与 `scripts/verify-real.mjs --run-codex`会真实调用Codex，普通测试不执行它们。

[报价证据与单位预算](docs/pricing.md) · [第二阶段实现与验收](docs/stage2.md) · [CLI适配边界](docs/novel-adapter.md) · [独立审阅](docs/script-review.md) · [官方公开契约](docs/jimeng-cli-audit-2026-11-15/script-cli-report.md) · [历史验收](docs/validation.md) · [下一阶段](docs/next-stage.md)。

后续软件设计输入见 [Huobao 功能拆解与已有账号接入设计](docs/huobao-breakdown-and-account-integration.md)，包含逐步制作流程、四岗位映射、免填 API Key 的账号与网页协作方案，以及分步开发和验收条件。文档已区分拆解时的初版快照与当前 0.2.1 工程，后续整合复用现有剧本、版本和独立审阅实现。

功能组织参考[火宝短剧](https://github.com/chatfire-AI/huobao-drama)公开项目说明，核心代码独立编写，未复制其业务源码或资源。

## 创作研究资料

[抖音150条作品学习与十五位导演预设手册](docs/research/2026-11-15-douyin-study/README.md)：三份Word、可检索文本版及来源记录，供后续提示词、运镜与风格数据库设计参考。资料归档不代表相关预设或媒体生成能力已经接入。

## 创作规则库与离线预览

新增[三个手册与Huobao整合方案](docs/creative-knowledge-v04.md)和独立编写的[提示词编译核心](src/creative-design.mjs)：15位导演、17个作品级预设，分别输出静态图与视频运动提示词，保留来源、用户锁和候选状态。90条新增手册扩展按需勾选；模型回答中的PASS不能代替正式阶段验收。

```powershell
node scripts/preview-creative.mjs --list
node scripts/preview-creative.mjs examples/creative/waiting-shot.json
```

知识库版本为0.4.0，工作台版本仍为0.2.1。本次新增内容可离线运行，尚未接入分镜页面、真实图像生成或视频提交。新的默认创作路线采用自有ChatGPT／Codex编写与审阅，图像、即梦画布／无对白视频与后期分步接入；既有即梦剧本工具保留可选。

