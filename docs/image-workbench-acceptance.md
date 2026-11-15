# 来源修复与分镜图片验收（2026-11-15）

执行 `git fetch origin` 后，确认 `origin/codex/creative-workbench-v04-20261115` 包含并指向 `f1e2c382bcb9c66f0543b5d15f8ba92dc8aa31c3`。从该提交创建独立分支 `codex/image-workbench-v05-20261115` 和独立worktree，未切换或覆盖原目录。两个既有工程的24份项目、任务和历史版本文件Hash逐一不变，工作树保持干净；认证未读取或迁移。

软件0.4.0，Windows、Node.js24.22.1。独立测试服务位于 [本机图片工作台](http://127.0.0.1:4319/images.html?projectId=68ce2862-81b7-4e64-be29-1c10aee653da)，数据为该worktree的 `data/image-acceptance/`。原4317和4318服务均保留。GitHub仅提供代码与脱敏记录，不能通过仓库访问本机服务。

## 来源漏洞与修复证据

用户复现的 `CHAR-99` 新增设定、`source=user`、`addedSettings=[]` 现在不会被认定为用户事实。服务端保留原声明及原文，另记 `pending_confirmation` 和具体原因，采用须明确确认仍待确认。合法新ID不一律归AI：完整描述与真实输入的指定字段、UTF-16偏移、摘录及快照Hash匹配时，可记 `verified_user_input`；明确AI来源且有对应补充说明时记 `ai_addition`。

13项来源回归包含伪造用户来源、合法提取、夹带新设定、错位置/Hash/路径、合法AI补充、缺说明、旧记录只读待确认、人工版本继承及绑定损坏。还验证了原快照和来源报告被一起修改时不能相互自证：原任务 `inputHash` 与版本的独立 `expectedSnapshotHash` 会阻止采用或下游洗白。详见[来源契约及限制](entity-provenance.md)。字符证据不代表脚本理解了否定句、剧情语义或真实身份。

## 测试与真实浏览器

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 基线完整测试 | 105/105通过 | 新功能前，正常Windows权限 |
| 最终 `node --test tests/*.test.mjs` | **134/134通过，0跳过** | 新增13来源、13图片、3 HTTP/能力测试 |
| `node tests/image-browser-smoke.mjs` | **7项通过，0页面异常** | 真实Chrome，7张实际测试PNG，7次人工选用记录 |
| `node tests/image-codec-browser.mjs` | JPEG和WebP均通过，0异常 | 实际HTTP上传/下载及Chrome解码；160×90的明确测试图片 |
| 原 `creative-browser-smoke.mjs` | 通过，0页面异常 | 4次隔离文字夹具调用；不是真实模型调用 |
| 原 `script-browser-smoke.mjs` | 通过，0页面异常 | submit/query均0；保留即梦文字费用门槛 |
| 独立服务持久验收与重启 | 7份文件、7次选用历史全部恢复 | SHA256逐一一致，真实Chrome仍可解码预览 |

格式检查覆盖PNG签名、块CRC、压缩扫描行，JPEG/WebP结构，截断/伪图/SVG/超限拒绝；HTTP检查上传元信息、字节往返、跨项目隔离、跨站拒绝和真实ZIP参考字节。JPEG/WebP结构校验不等于对任意图像完成了完整像素或视觉内容验收，人工检查与浏览器预览独立保留。

图片浏览器操作使用文件控件实际上传，非只写JSON。先导入并选用人物/场景参考，再为3镜各导入图像；导出ZIP实际含2张选定参考图，`includedInBundle=true` 且 `attached=false`。仅SHOT-02换图后，旧文件和历史保留，另外两镜选用不变。人物参考换版使依赖图片需复核；上游输入改变后旧版明确过期。旧包下载被409拒绝，页面显示具体错误，不把错误JSON当ZIP。关联旧包的回图保留原快照，不能盖成当前Hash。

曾发现离屏lazy图片未加载导致测试等待超时，验收脚本改为先滚动再等待实际解码，最终通过。开发中补齐了已采用分镜的完整过期检查、引用实体版本校验、原图磁盘Hash失效向下游传播及完整导入快照，并增加对应回归。

## 独立持久项目

项目 `68ce2862-81b7-4e64-be29-1c10aee653da` 使用明确的软件测试构思、人工测试剧本/分镜，目标30秒、3镜头，未调用Codex创作。7张图片由确定性像素代码制作，画面明确写 `TEST FIXTURE / NOT AI`，`source.kind=test`。这些图片只证明上传、格式、绑定和版本流程，不能冒充真实AI生成、人物一致性或审美效果。

`scripts/verify-image-local.mjs --run-test` 已验证三镜绑定、实际参考ZIP、单镜换图、原图可读、参考变化与输入变化；重启后 `--restore` 逐一下载比对7份文件Hash，并核对7次选用历史和真实Chrome显示。当前页面保留变更后的“需复核”状态，这是验收预期，不是自动把旧图认定为合格新稿。

机器证据：[acceptance.json](image-workbench-evidence/acceptance.json)。截图：[三镜选用](image-workbench-evidence/browser-three-shots.png)、[变更需复核](image-workbench-evidence/browser-needs-review.png)、[独立持久项目](image-workbench-evidence/local-three-shots.png)、[重启恢复](image-workbench-evidence/local-restored.png)。完整原图、任务包及私有记录保留在本机，公开资料只导出非个人测试信息。

## 工具、费用与未完成项

只读核查确认本机Codex `0.167.0-alpha.4.1` 已登录，`image_generation stable true`；[官方文档与实际帮助检查](image-tools-check.md)分别保存。存在官方图像创作路线，但本工作台自动执行、产物契约及当前费用尚未验证，本轮没有安装或暗中调用API。费用保持待确认，未编造免费、兑换率或报价编号。

本轮真实模型、图像生成、即梦画布、视频、配音及剪辑提交均为0。正式四岗位guard、15份正式生产文件与账本未接入，`formalStageStatus=not_checked`。实际图片状态为已导入且未正式媒体验收；人工选用不等于正式制作包或成片PASS。后续需单独验证自动图像连接器、账号费用与正式工作区接入。
