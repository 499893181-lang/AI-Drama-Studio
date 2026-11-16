# AI-Drama-Studio

当前0.10.0在 C·调整版中增加四标签剧本工作区与右侧 AI 创作助手：正文按场景／段落点击分页，生成后直接编辑，一次确认统一保存版本并绑定分镜来源。助手读取本项目、步骤、当前编辑版本与精确选段，保存项目隔离的多轮对话；建议先对照，明确应用才保存待确认 AI 版本，来源不被洗白，旧稿和下游复核规则保留。[剧本与助手使用说明](docs/script-assistant-v11.md) · [本轮实际验收与限制](docs/script-assistant-v11-acceptance.md)。默认 [4317](http://127.0.0.1:4317)，本机此次 [4320](http://127.0.0.1:4320)。

0.10.0基于 PR #9 的 `codex/ui-c-adjusted-v10-20261116`、`b3a683c5b00017fa66b406ece50205cafd61c3b8`；实施分支 `codex/script-assistant-v11-20261117` 为堆叠PR，不自动合并。真实助手验收最多两轮：第一轮完成；第二轮带历史及选段，但验收等待竞态提前关服务，中断且未返回完整改稿或用量、未应用，没有第三轮。等待helper已修并通过两项隔离回归，不能将隔离应用算作真实改稿成功。仍复用本机Codex账号用量，人民币／积分费用未知；本轮不生成图片、视频或配音，不重置原1/1及授权控制。

0.9.0历史改版将真实应用统一为已确认的 **C·调整版**：完整保留窄图标栏、相邻项目面板、七步制作流程和四个资源入口；顶部只保留项目路径与必要操作，删除重复横向流程。各页共用蓝白设计变量、字体与间距，主要动作和下一步说明集中在底部，原编辑、审阅、版本、任务恢复和手工素材流程保留。[界面与使用说明](docs/ui-c-v10.md) · [实际验收及前后截图](docs/ui-c-v10-acceptance.md)。默认入口为 [4317](http://127.0.0.1:4317)，该轮本机使用 [4320工作台](http://127.0.0.1:4320)。

0.9.0基于 PR #8 的 `codex/canvas-video-execution-v09-20261116`，基线 `1900352f1ff4fd6142906d4a89e437bd700b932f`；实施分支为 `codex/ui-c-adjusted-v10-20261116`，属于保留前序功能的堆叠PR，不自动合并。步骤状态来自当前版本、Hash和人工选用的只读汇总，不是正式guard PASS。此次未新增真实模型或媒体调用；认证、预算授权、历史任务与图片原1/1保持，自动出图继续关闭，配音与字幕尚未接通。下方旧版本说明保留为历史记录，以本轮独立验收为准。

Windows 本地中文 AI 短剧工作台，MIT 开源。0.8.0历史版本完成待本人批准的画布单镜执行、原ID恢复、下载与无声候选链；该轮无签名批准，真实消费未执行。原立项、文字分镜、图片、direct视频准备、本地时间轴和MP4导出保留。

0.8.0[本轮验收](docs/canvas-video-v09-acceptance.md)：317/317完整回归、9组新工作台Chrome及3组实际主服务检查通过。官方既有TEST MP4上传/导入/下载已实际验证，原/下载Hash相同，非AI生成证据。新链路绑定具体任务、草稿、输入及参数，由仅本机签名批准控制，无HTTP发放授权接口；未知结果只查原submitId，下载失败只恢复下载。当前同节点最大预估70积分，未确认或生成。[可确认首次单镜方案](docs/video-first-run-plan-v09.md) · [工作台与本机批准说明](docs/canvas-video-workbench-v09.md) · [下载预检](docs/canvas-video-download-v09.md)。原530文件及图片1/1保持。

0.7.0[本轮验收](docs/video-prep-v08-acceptance.md)：已登录canvas保存独立测试视频空草稿，同节点5秒720p报价最大预估70积分，0生成/0消费确认；资格、视频下载、真实产物与实际扣费未验收。direct认证与价格保持独立。[渠道与报价证据](docs/canvas-video-channel-v08.md) · [可审核单镜验收方案](docs/video-real-acceptance-plan-v08.md) · [本地时间轴说明](docs/local-timeline-v08.md)。100积分仅为未授权计划预算。主服务沿用原数据目录，原507文件Hash不变、图像原1/1不重置。

0.6.0[本轮验收](docs/video-v07-acceptance.md)：252/252回归及真实Chrome通过，测试视频明确TEST FIXTURE / NOT AI，0真实视频/图片/模型调用。实际CLI直连未登录、canvas已登录；direct报价未知、无原生静音参数，分别显示，不冒充免费或已接通真实生成。[视频使用说明](docs/video-workbench-v07.md) · [CLI核查](docs/jimeng-video-cli-v07.md) · [待确认的单镜真实验收方案](docs/video-real-acceptance-plan-v07.md)。

0.5.1[历史无新增生成验收](docs/image-contract-v061-acceptance.md)：215/215回归通过；故障立即请求异步中断，不能保证拦住已开始调用。实际Schema允许`inputImages`缺省、无default；会话、工具本地读取及远端使用分别记录。原DATA_DIR中499份文件Hash不变，仅追加独立诊断，原失败任务与1/1保持。四项状态分别显示已有真实产物、保护未验证、参考未验证、候选未通过，未新增模型turn或图片。

公开仓库：[499893181-lang/AI-Drama-Studio](https://github.com/499893181-lang/AI-Drama-Studio)。网页版调试先读[调试入口](docs/CHATGPT_CONTEXT.md)与[源码索引](llms.txt)。GitHub提供代码和文档；本机服务、个人项目和认证不会随仓库公开。

## 启动

双击 `start.cmd`，或执行：

```powershell
.\scripts\start.ps1
# 已有Node时也可
node .\src\server.mjs
```

打开[故事立项](http://127.0.0.1:4317)、[Codex创作与分镜](http://127.0.0.1:4317/creative.html)或[可选即梦文字](http://127.0.0.1:4317/script.html)。需要Node.js22+，没有npm运行依赖或独立数据库。启动器支持 `NODE_BIN`、PATH和已安装CodexPrimaryRuntime，不下载程序或修改全局PATH。保留旧服务并行验收时可用 `.\scripts\start.ps1 -Port 4318`，打开对应4318地址；每个服务须使用独立数据目录。

[分镜图片工作台](http://127.0.0.1:4317/images.html)从已保存分镜开始。独立图片实施worktree可用 `.\scripts\start.ps1 -Port 4319`，打开 [4319图片入口](http://127.0.0.1:4319/images.html)。[图片操作与数据说明](docs/image-workbench.md) · [本机图像能力核查](docs/image-tools-check.md)。

0.5.0[历史验收](docs/auto-image-acceptance.md)：修复参考审核撤销及来源分镜过期后旧包仍可用的问题；实现任务持久化、去重、原绑定与失败原图保留。现有Codex账号实际完成一次图像调用、得到一张真实图片，但私有hook执行失败且图像事件缺少参考附件证明，**自动验收未通过**，没有自动导入或选用。当前入口明确显示缺口并禁止新提交。独立服务为 [4320图片入口](http://127.0.0.1:4320/images.html)，使用独立数据目录。[使用说明](docs/auto-image-workbench.md) · [官方契约与实际缺口](docs/codex-image-contract.md)。

0.4.0[历史验收](docs/image-workbench-acceptance.md)：134/134测试通过；真实Chrome验证三镜头图片绑定、单镜换图、参考及输入变更需复核、实际ZIP、旧版保留和重启恢复。该轮测试图片均明确标注非AI生成，未发起模型或图像生成任务。

## 当前功能

- 画布单镜待授权执行：[主服务页面](http://127.0.0.1:4320/canvas-video.html?projectId=76e18591-47fc-48cf-992d-112d183a3036)展示实际首帧、同节点最新报价、完整范围、原submitId和待本人批准状态。本地签名只覆盖该任务与70积分最大预估阈值，网页不能自发授权；短期消费凭证不落盘。原片保留，若有音轨则本地静音派生并FFprobe复核，再入候选、人工检查与选用；原始回执、Hash、版本和失败记录保留。模型实际资格和首帧符合性留首次获批任务验收。

- 本地时间轴：从当前人工检查选用的视频添加、排序、移除、保存不可变版本，绑定镜头版本和实际Hash；兼容H.264 MP4无损拼接，保留原音轨或明确后处理静音派生。FFprobe与浏览器检查输出；失败、取消、超时、重启不自动重导，不损坏原片。当前只验收明确TEST素材，不冒充AI成片。主服务[时间轴测试项目](http://127.0.0.1:4320/timeline.html?projectId=437306c6-d0b8-4b1b-86b4-6c259c89b006) · [只读报价页](http://127.0.0.1:4320/video-channel.html)。

- 单镜视频：从当前有效且人工检查选用的镜头图准备任务，绑定图片/分镜版本、审核/选择ID及实际Hash；独立积分费用与预算门槛、先落提交意图、原ID查询和下载恢复。FFprobe核验实际文件并预览，候选/检查/选用分开；重做留旧版、源变需复核。真实生成未验收、本轮关闭，canvas媒体导入仅检测未验证。

- 图片工作台：逐镜实际提示词、导演规则、实体版本引用；PNG/JPEG/静态WebP上传、预览、文件Hash/尺寸/来源声明；人工检查和选用分开，单镜换图追加版本，旧文件和选择历史保留。导出JSON及含实际参考图片的ZIP，下载和执行前重新核对目标、来源分镜、当前审核、版本及实际文件Hash；审核撤销使下游图与旧包需复核。官方账号自动任务保留提示词、输入快照、附件与调用记录，失败图可下载但不冒充成功候选。费用待确认，不切换付费API。
- 来源保护：新增实体自报 `source=user` 需可定位输入证据；无充分证据保持待确认，AI补充保留说明。采用和下游核对快照与实体Hash，历史原文保留，不补造证据；待确认候选须显式确认保存，不能因此变为用户事实锁。
- Codex创作与分镜：本机官方CLI生成剧本候选、分镜候选，新会话独立审阅，人工采用/编辑保存。15位导演、17个作品级预设显示规则来源，90条手册扩展显式勾选，案例默认关闭。静态、摄影和后期声音分栏；任务包及提示词可导出。采用前从当前存储重编译Hash，保留人工稿、原始回执及不可变版本。[操作与能力边界](docs/creative-workbench.md)。
- 故事立项：项目列表、默认30秒、横竖屏、画风、参考素材、预算、真实Codex扩写、人工修改、revision冲突保护与重启恢复。候选采用一次写入正文与来源，备份保留旧人工稿。
- 剧本输入：从当前保存的创作说明确定性整理大纲/单集参数，显式绑定并只读核验真实即梦画布与空间ID，不自动创建画布。
- 即梦适配：官方 `script outline`、`script episode`、`script result`，提交前保存幂等键，保存thread/run和原始回执。中断后查询原任务，缺ID时禁止猜测重提。只有真实终态、有效ID和本次CLI导出的非空完整正文才提供候选。
- 稿件版本：分别查看大纲、即梦候选、人工稿，编辑保存为新版本，保留历史并可切换活动版本。没有已验证的即梦Agent定向改稿接口，人工保存不冒充Agent修改。
- 独立审阅：用户点击后新开真实Codex会话，检查用户要求、人物动机、逻辑、时长、连续性和制作难度，报告独立保存。输入或活动稿变化后旧稿/报告显示需要复核。

**即梦文字费用边界：官方说明剧本按产出字数计费且不支持总价预检，当前仍缺本账号CLI每字费率或免费凭证，因此显示“费用待确认”，即梦提交受阻。Codex文字路径独立可用，沿用本机账号额度。** 报价模块支持有真实依据的免费、积分和人民币，分别记录渠道、来源、单位、条件与有效期；积分和人民币分别设预算，不推汇率，不造官方quoteId。 准备任务仅保存输入与request-id，不消耗生成额度。项目人民币预算、账号余额及图像/视频节点估价均不能代替剧本报价。隔离测试中的已知零费用夹具不是生产价格。

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
node tests/creative-browser-smoke.mjs
node tests/image-browser-smoke.mjs
node tests/auto-image-browser-smoke.mjs
node tests/auto-image-failure-browser.mjs
node tests/video-browser-smoke.mjs
node tests/timeline-browser-smoke.mjs
node tests/canvas-video-browser-smoke.mjs
```

浏览器测试使用明确隔离夹具与临时数据，需要本机Chrome/Edge；其假审阅报告不能算真实模型结果。第一阶段 `tests/browser-smoke.mjs --expand` 与 `scripts/verify-real.mjs --run-codex`会真实调用Codex，普通测试不执行它们。

0.3.0[本轮独立验收](docs/creative-workbench-acceptance.md)：105/105测试通过；真实Codex剧本、分镜及不同会话独立审阅各一次成功，候选审阅六项PASS。真实Chrome采用及人工保存、服务重启恢复通过；人工修改后旧报告按预期需复核。显式真实验证脚本及数据隔离要求见[工作台说明](docs/creative-workbench.md)。

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

知识库版本为0.4.0，软件工作台版本为0.4.0，二者分别管理。规则核心已接入文字与分镜页面；图片手工任务包、实际文件导入和人工选用已接入，自动出图、即梦画布／无对白视频及后期仍未接入。默认文字路线采用本机Codex；既有即梦剧本工具保留可选。四岗位正式guard与账本尚未接入，因此候选有效、人工采用、选图或模型审阅PASS均不代表正式制作包通过。

