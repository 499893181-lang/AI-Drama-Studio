# 单镜头图片工作台0.5.0独立验收

日期：2026-11-15，Windows，Node24.22.1。基线分支`codex/image-workbench-v05-20261115`包含`218772af36166705958e42a31a31e6ac171ebfd1`；实施分支`codex/auto-image-v06-20261115`，不自动合并。

**修复与隔离流程通过；真实自动出图验收未通过。** 本轮只提交一次真实Codex turn，恰好一个图像工具开始/完成事件，得到一张实际PNG。PreToolUse启动失败且runtime继续执行，图片事件没有`inputImages`，无法证明单次拦截和参考实际附加。自动能力检测和runner已同时关闭新提交，未因文件存在而放松成功门槛，也未再次生成。

## 旧包与参考失效修复

- 人物参考通过并选用后，生成的下游图和包绑定当前审核ID、结论、`reviewCurrent`、文件Hash及版本。参考改判rejected、审核失效或文件变化，下游图转为需复核，旧包不能继续执行。
- 再次审核通过会产生新审核ID，不能复活按旧审核生成的包。历史图片、审核、选用及任务包记录保留。
- JSON首次下载、再次下载、复制提示词、ZIP下载与自动执行统一读取当前存储门禁。来源分镜过期或`target.ready=false`时，即使旧Hash还一致也返回409；缓存JSON不绕过检查。
- 新任务保存原包、输入快照和参考文件。成功路径须有官方完成事件、附件Hash/实际路径证明、实际图片、Hash与浏览器解码，才能导入不可变候选，之后仍须人工检查选用。
- 提交意图先落盘，重复点击不重复调用；取消、超时、重启和迟到产物都保留原绑定，不自动重提。损坏任务历史时暂停提交，不能少算次数；恢复产物不改原失败状态和错误。

## 测试结果

`node --test tests/*.test.mjs`：**171/171通过，0失败**。基线134项；新增参考/旧包回归7项、HTTP门禁2项、任务与恢复22项、原生契约及hook6项。测试均不调用真实模型。

| 真实Chrome场景 | 检查数 | 结果与证据边界 |
| --- | ---: | --- |
| 手工图片工作台 | 7 | 三镜绑定、换图、历史、当前JSON/ZIP门禁与重启，明确TEST FIXTURE |
| 自动候选隔离流程 | 5 | 注入runner一次；生产像素解码器、人工检查和选用、过期及恢复，不是真实生成 |
| 失败产物隔离流程 | 3 | 未验收原图只读下载、失败占次数、手工流程保留，0真实调用 |
| 原创作工作台 | 7 | 文字候选、规则、人工版本与过期恢复，模型为隔离夹具 |
| 原剧本工作台 | 8 | 未知费用门禁、输入/绑定、版本、报告和恢复，即梦为隔离夹具 |
| 本轮已有真实原图 | 5 | 浏览器解码、手工拒绝检查、原包绑定、输入变化及服务重启恢复，0新增生成 |

以上浏览器均0未处理页面异常。PNG/JPEG/WebP还各以生产Chrome解码器验证一次，0生成调用。早期手工smoke因旧错误文案断言失败，已改为先核实HTTP409、再核对相同后端错误；原失败日志保留，最终复验通过。

## 唯一真实图像结果

独立非个人测试故事“等一杯茶”，30秒、三镜人工验收输入，仅对`SHOT-01`生成一张。计划参考是一张明确写有TEST FIXTURE / NOT AI的软件色块图，不是既有真实场景或人物，不作为视觉一致性证明。

| 证据 | 实际结果 |
| --- | --- |
| 任务 | `8eb1182e-5a89-47fe-9220-2e1ea08c1f00` |
| 提交时间 | `2026-11-15T10:34:48.587Z` |
| thread / turn | `01a1dec6-2d54-7ce0-92c8-f02908d619f1` / `01a1dec6-2dd8-7502-be10-4438d14271ee` |
| 官方图像item | `exec-76957a5d-1187-4dcf-b165-fca994539d0f`，completed |
| generationId | `b2de9922-5394-4374-988d-6be4ecb024b1` |
| 官方turn | completed；这不等于本工作台验收成功 |
| 实际文件 | PNG，1672×941，2,023,286字节；与官方base64返回字节一致，Chrome实际解码成功 |
| SHA256 | `bbe2683b21c5362a8cd501e322310ad716437c6fe4afb431de7897dd486c6738` |
| 原任务 | failed，原错误“未找到私有hook准许的原生图像调用证据。”，`result=null` |
| 参考附件 | 官方完成事件没有`inputImages`，未验证；不能用已提交到会话的localImage补造证明 |
| 采用 | 没有自动候选、没有自动选用；开发验收另沿手工流程导入并明确拒绝，非用户签收 |

[真实原图](auto-image-evidence/real-image.png) · [脱敏机器证据](auto-image-evidence/check.json) · [未通过自动验收页面](auto-image-evidence/real-failed-artifact.png) · [手工拒绝检查](auto-image-evidence/real-manual-rejected.png) · [输入变化需复核](auto-image-evidence/real-input-stale.png)。

实际原图与原始RPC事件、请求、私有guard、错误原文保留在本机独立data目录。失败后只追加可信解码及Hash恢复记录，没有补造hook marker、重写原状态或伪造附件。手工导入记录的`source.kind=other`、`generation=null`，明确写明缺失证据，并绑定原packet及`inputSnapshotHash`；浏览器检查为rejected，未选用。输入改变后旧图需复核、旧包409；服务重启后全部状态恢复，原失败任务仍占本轮1/1次数。

## 账号用量和费用

使用现有官方ChatGPT登录，`account/read`返回chatgpt / prolite。调用前官方`ordinaryUsageAllowed=true`；主窗口10080分钟，用量百分比34；调用后通知仍为34。credits余额0、hasCredits=false。这里记录的是窗口百分比及余额，不能推导本次单图消耗或免费。

本次人民币费用、积分费用、单图精确账号消耗均**未知**，分别保存null。没有购买额外额度，没有配置API Key或切换付费API。普通CLI探测、Schema生成、空会话hook诊断和浏览器验证都未新增模型turn。官方说明与调用契约见[独立核查](codex-image-contract.md)。

## 具体未完成项

1. 实际PreToolUse启动失败的原因是会话使用PowerShell，原裸引号命令未调用程序。最初COMSPEC夹具漏掉此分支；现已修正启动器并通过原生空会话SessionEnd验证stdin、中文和空格路径。但hook错误时runtime继续执行仍是事实，修正后的真实单次拦截及错误停止策略尚未验收。
2. 当前实际图像完成事件未返回`inputImages`，仍缺参考图被图像工具实际使用的官方证据。没有删掉该验证来让任务变成功。
3. 本轮最多一次真实调用已用完，不能再试来掩盖上述缺口。新数据目录、功能标志或提高本地上限均不会自动打开真实runner；下一轮先解决官方执行与附件契约，再在明确授权范围内验收。

正式四岗位guard/账本仍未接入，`formalStageStatus=not_checked`，不宣称正式制作包PASS。没有提交即梦画布、视频、配音或剪辑任务。

## 本机入口与复核

本轮服务：`http://127.0.0.1:4320/images.html?projectId=2fabba3a-6f4a-4b2f-b714-8506a4b42f64`，独立`DATA_DIR=data/auto-image-acceptance`，上限固定1。原4317/4318/4319服务保留；三个既有工程的37份数据文件与实施前Hash一致，未迁移认证、任务或图片，未覆盖未提交修改。

普通回归及两个自动页面夹具：

```powershell
node --test tests/*.test.mjs
node tests/image-browser-smoke.mjs
node tests/auto-image-browser-smoke.mjs
node tests/auto-image-failure-browser.mjs
node tests/creative-browser-smoke.mjs
node tests/script-browser-smoke.mjs
```

`scripts/verify-auto-image-real.mjs --observe`只观察原失败任务，会如实以非零退出，不代表要重提。`scripts/verify-auto-image-retained.mjs`只读复核已有真实原图；`--manual-check`仅允许上述独立验收项目的手工导入、拒绝及过期检查，不调用生成。`scripts/export-auto-image-evidence.mjs`按白名单导出公开证据，不复制原始日志或认证。个人data、认证与完整运行记录继续Git忽略。
