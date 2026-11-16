# 首次生成前的视频资源下载预检 v09

2026-11-16，Asia/Shanghai。基于`af4d70413e0064c43f2152796346252bce47008c`。复用已登录的官方`dreamina-canvas 1.2.0`，在独立测试画布上传、导入并下载**已有TEST FIXTURE / NOT AI视频**。这次已实际证明该视频资源可以通过官方CLI下载，未执行任何视频生成或消费确认。

## 实际边界与操作

先读本机实际`schema`及`resource upload`、`node create video`、`resource download`帮助：上传明确支持本地视频并登记为项目资源，`confirmation=false`；视频节点摘要明确“不触发生成”，`run`默认false且约束“only save the draft”。`--resource-id`挂已成功登记的视频资源，`--import-kind local_upload`说明来源，`submit-id`仅为此次导入批次身份。没有`--run`，没有调用`node confirm`或`node run`，没有`--yes`。

创建前完整查询同名画布目录；仅有此独立测试画布，创建未带`--use`，不改变当前生产画布。请求前保存稳定project/resource/node/update/import-submit身份；恢复使用原身份。已执行的官方命令分别为：

```text
dreamina-canvas resource upload --project-id <testProjectId> --resource-id <stableResourceId> --file <existingTestMP4> --type video --import-kind local_upload --name <TEST label> --non-interactive
dreamina-canvas node create video --project-id <testProjectId> --node-id <stableNodeId> --update-id <stableUpdateId> --submit-id <stableImportSubmitId> --resource-id <registeredResourceId> --import-kind local_upload --title <TEST label> --non-interactive
dreamina-canvas resource get <registeredResourceId> --project-id <testProjectId>
dreamina-canvas node show --project-id <testProjectId> --node-id <stableNodeId>
dreamina-canvas resource download <registeredResourceId> --project-id <testProjectId> --output <newLocalPath> --non-interactive
```

实际Schema下载摘要仍写“安全下载成功的图片素材”，而参数是通用resource-id。本轮没有把这段文字当作视频支持保证，直接使用获准上传的已有视频做了无生成实测：下载退出0、JSON ok=true、资源ID一致、文件存在，CLI大小/Hash与本地实测一致。**结论只限此次已有视频资源下载**；AI视频生成资格、生成终态、首帧符合性和最终扣费仍留待首次获批任务，不要求在生成前先证明。

## 真实测试绑定

| 字段 | 实际值 |
| --- | --- |
| 独立画布 | `AI-Drama-Studio_v09_视频下载预检`，`5a79568c-c830-48c5-b697-53066890d4ec` |
| 画布链接 | [官方测试画布](https://jimeng.jianying.com/ai-tool/ai-canvas/5a79568c-c830-48c5-b697-53066890d4ec) |
| 既有视频节点 | `node_xb9jksrkm7`，success，唯一资源绑定且source=uploaded |
| 已登记视频资源 | `76eab309-20f1-4e81-ba3b-96d372a25b5d`，type=video，status=success |
| 导入批次submitId | `34578191-16b1-4ab8-ba4c-f5e1776fbba9`，不是AI生成任务ID |
| 输入文件 | [已有TEST MP4](video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4)，本轮没有新增AI视频 |
| 下载请求ID | `20261116101235EFE49BA027D675FAFE33` |

## 原文件与下载文件

两者均保留。原片和下载片SHA256相同：`7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3`，17750字节，实际字节一致，未观察到平台重写或媒体差异。

FFprobe分别核验：MP4容器、H.264、yuv420p、1280×720、24/1fps、5秒、1视频轨、0音轨。Chrome分别真实加载解码和播放，readyState=4，时钟实际前进；无页面未处理异常。[机器记录](canvas-video-download-v09-evidence/check.json) · [官方回执脱敏摘录](canvas-video-download-v09-evidence/receipts.json) · [实际播放截图](canvas-video-download-v09-evidence/test-resource-download-playback.png)。截图中的两片均明确显示TEST FIXTURE / NOT AI。

原片已无音轨，这次下载预检不声称验证了有声转无声。首次真实生成若返回音轨，应保留原片、单独本地去音轨派生，保存父/子Hash并FFprobe确认派生0音轨；这是后处理静音，不是模型原生无声。

## 实现、隔离测试与记录

`src/canvas-video-download.mjs`只提供官方只读资源下载：显式画布/资源、全新绝对目标路径，下载runner自身也拒绝已有输出，防止覆盖原片。回执必须有实际相同resourceId、绝对path、size、SHA256；再核对本地真实文件并实际FFprobe，不把URL、成功文字或路径本身作为成功证据。CLI回执没有projectId，该字段仅记录请求绑定，不补造服务端返回。

7项新增隔离回归覆盖：官方argv/新路径、无生成旁路、真实既有TEST媒体检查、缺失/错资源/错路径/大小Hash、退出/超时/损坏回执、假MP4及仅重试下载。隔离回执不作为实际官方成功证明；本轮实际成功证据独立保存。完整回归由主验收记录汇总。

`scripts/audit-video-download-v09.mjs --prepare --download --browser --write-evidence`仅可做登记/下载/播放，没有生成或授权模式。每轮收据存私有唯一不可变目录；原始退出码、脱敏JSON/stdout/stderr、稳定身份和实际文件保留。公开只导出非个人测试摘要，认证、临时URL和访问材料不进Git。正式guard与账本保持not_checked；未触碰原图片1/1记录。
