# 图像参考附件契约复核（0.5.1，无新增生成）

核查日期：2026-11-15。基线`7a19ac93aa6d9538dddefccffbe7dd70423411c7`。本轮只导出实际Schema、读取已有任务及原始RPC，并以Chrome重新解码既有图片；**没有新增模型turn或图像生成**。原有1/1提交记录、失败状态、错误、回执、图片及缺失marker保持不变。

## 本机实际Schema

实际运行本机`codex-cli 0.167.0-alpha.4.1`：

```text
codex app-server generate-json-schema --experimental --out <新worktree的忽略目录>
```

`codex_app_server_protocol.v2.schemas.json` SHA256仍为`d9dc3bfe984335642465586c94117e90adb11943c94d8142d0a906221f092e44`。完整本机Schema留在`tests/.artifacts/contract-v061/schema/`，没有把认证或账号回执上传。

| 字段 | 实际约束 | 证据范围 |
| --- | --- | --- |
| `ThreadItem.imageGeneration` | required只有`id`、`status`、`type`；另有result/fileId联合产物约束 | 完成终态与产物独立核对 |
| `inputImages` | array，非required，**没有default** | 允许缺省；缺失保持null/未返回，不补为空数组，不视为官方违反必返契约 |
| `ImageGenerationInputImage` | required为`path`、`sha256` | 描述本次图像请求成功读取的本地文件 |
| `sha256` | string；说明要求归一化前原文件字节的小写SHA256；Schema未另加正则 | 用本地实际文件核对，不代替远端使用或视觉一致性证据 |
| `UserInput.localImage` | required为`path`、`type`，没有Hash字段 | 会话发送及回显的路径不是服务端文件Hash回执 |
| `generationId` | optional，nullable，default null | 保留实际值，不补造 |
| `savedPath` | optional，nullable绝对路径 | 必须另读实际文件并核Hash、解码；返回字符串不是文件成功证明 |
| `HookCompletedNotification` | `run`与`threadId`必填，turnId可缺省/空；`HookRunSummary`无tool_input字段 | hook通知摘要不能用作实际工具参数日志 |

Schema中`inputImages`说明的含义是已完成生成的本地输入观察，旧条目可没有。其元素说明限于该次图像生成请求成功读取的文件，Hash位于图像归一化之前。它不是图像后端的独立使用回执，更不证明输出画面符合参考要求。此前把本工作台所需的附件验收条件描述得像官方必返契约不准确，本轮明确更正。[官方App Server说明](https://learn.chatgpt.com/docs/app-server)描述通用RPC及item生命周期；具体实验字段以本机实际Schema为准。

## 已有真实任务的七层证据

原任务`8eb1182e-5a89-47fe-9220-2e1ea08c1f00`，thread `01a1dec6-2d54-7ce0-92c8-f02908d619f1`，turn `01a1dec6-2dd8-7502-be10-4438d14271ee`。

| 层级 | 现有真实证据 | 不能推出的结论 |
| --- | --- | --- |
| 计划清单 | 1份参考，SCENE-01@v1，本地测试色块，Hash `8c88484107d20940dfd54c6a41ced4a3c9b2d644138f92d2bd1db460e701846d` | 计划不证明实际发送 |
| 会话发送 | 原turn/start请求记录含1个localImage；**原请求日志写在stdin写入之前**。本次另有同turn的官方userMessage回显，可共同证实会话附件传递 | 请求日志单独不能证明写入、网络接收或工具使用；新增管道回调也仅证明CLI stdin写入 |
| 会话接收 | item/started及item/completed回显同一userMessage的localImage路径；重复生命周期只算一份 | 会话接收不等于图像工具读取；没有服务端Hash |
| 工具参数 | 原生imageGeneration条目没有工具参数字段；原PreToolUse失败，没有可信参数日志或准许marker | 不用计划、会话附件、revisedPrompt或缺失marker补造实际参数 |
| 工具本地读取回执 | imageGeneration完成事件**没有inputImages**，保留null/未返回 | 不解释为零参考或已使用；不以fixture里有字段证明官方必返 |
| 远端使用回执 | 未发现已验证的独立后端参考使用回执 | 即使未来返回inputImages，也不能把本地读取证明提升成后端使用证明 |
| 视觉检查 | 仍须检查人物、场景、构图及参考一致性；本轮仅验证旧图解码及保留 | 协议、Hash和终态都不等于画面符合要求 |

参考色块本来就是明确的TEST FIXTURE / NOT AI，不作为人物或场景一致性通过证据。[官方图像说明](https://learn.chatgpt.com/docs/image-generation)允许使用参考图作为视觉引导，但没有为本机完成事件承诺独立的后端参考使用回执。

## 官方允许的其他入参观察

[官方Hooks说明](https://learn.chatgpt.com/docs/hooks)允许PreToolUse通过stdin观察`tool_input`、`tool_use_id`，并对支持的工具返回`updatedInput`。这可记录调用前所观察或请求改写的参数；即使记录成功，也不能独自证明原生工具最后执行了这些参数，更不能证明远端模型实际遵循参考。

本次原hook在脚本进入前就失败，通知只含失败摘要，因此实际工具参数仍未知。`src/image-evidence.mjs`把可选hook输入记录标为“调用前观察”，不会提升为已执行工具参数。未来若官方返回`inputImages`，则单独归入`toolReadReceipt`并核本地文件Hash；`serverReceipt`保持独立，不拿本地读取回执冒充后端使用。

本轮为未来正常启动的私有guard增加实际采集路径：生成的新脚本把真实stdin的`hook_event_name/tool_name/tool_use_id/tool_input`追加到本次私有`hook-inputs.jsonl`，记录stdin及tool_input Hash、当前与预期manifest Hash。单独的`requested_rewrite`记录保存拟返回的`updatedInput`及Hash。原始输入与单条观察记录均限制为1MiB；非法JSON、无有效tool_input、过大内容或观察文件写入失败均返回deny，不继续放行。两类记录都明确`finalToolExecutionVerified=false`、`backendReferenceUsageVerified=false`；它们提供调用前观察及请求改写证据，不是最终执行或后端使用证明。原v06生成脚本、marker及数据没有修改。

## 产物与执行保护分开

唯一既有图片为PNG、1672×941、2,023,286字节，SHA256 `bbe2683b21c5362a8cd501e322310ad716437c6fe4afb431de7897dd486c6738`。本轮再次读取原文件，确认它与原官方base64字节相同，并以生产Chrome解码器实际解码；原imageGeneration与同turn均为completed。这些证据足以显示“真实图片已产出”。

原hook失败且工具仍继续，是执行保护未通过的证据。应用提交意图1次、turn/start请求1次及ack 1次、已观测图像工具开始1次/完成1次分别记录，不能把一个应用意图当成严格一个工具调用保证。未观测数量在日志不完整时保持null；重复事件按相同item生命周期去重，不把重复回显误计成新调用。

[官方Hooks文档](https://learn.chatgpt.com/docs/hooks)将hook定位为辅助防护，并说明部分工具路径可不走默认hook路径；启动、超时或输出错误等失败不能当作可靠阻断。[turn/interrupt](https://learn.chatgpt.com/docs/app-server)是取消活动turn的异步请求，不能倒退或保证拦住已经开始的工具调用。因此现有官方执行边界**不能给出严格单次图像调用保证**，自动入口继续关闭。提示词、本地原子marker、故障夹具成功和观测到一次历史调用均不能替代此保证。

## 实现与本轮验证

`summarizeImageEvidence()`纯函数只投影证据，不写原job。界面分别使用artifact、protection、references、acceptance四维状态，分别显示真实产物、执行保护未验证、参考使用未验证及完整候选未通过，原失败状态/错误仍保留。fallback只有产物元数据时保持unverified，不能伪装成新的文件Hash或像素检查；fixture始终单独标识。

`tests/image-evidence.test.mjs`的11项隔离回归覆盖Schema optional/default、请求记录与实际传输区别、管道写入与服务端接收区别、会话回显、产物与失败并存、本地读取与后端使用分层、缺省/空数组/非法null及非法元素、重复/多次及跨会话事件、fixture不能升级为真实证据。全部通过，0真实调用。

另有`tests/image-hook-observation.test.mjs`的一项本地无操作脚本回归：实际向新guard进程stdin传入模型参数，核对私有记录、manifest/输入Hash、拟改写参数以及不提升最终/后端证明；非法、缺失与超过1MiB的输入均deny且无marker。只执行本地脚本，不运行Codex或图像工具。

`scripts/audit-image-evidence.mjs`只读原任务，输出新worktree的`tests/.artifacts/contract-v061/audit/{diagnostic-report.json,audit-manifest.json}`。实际核对9份原文件前后Hash不变，原marker前后均不存在，原任务仍failed且错误原文不变；报告可追加到独立诊断存储，不能追改原任务。无新增生成，亦无即梦画布、视频、配音或剪辑任务。
