# 本机 Codex 单图调用契约核查

检查日期：2026-11-15。本轮唯一真实验收已生成一张实际图片，但自动流程验收失败：原生hook启动失败，工具仍继续执行，完成事件缺少实际参考附件证明。原图、原始回执和失败原文保留；未导入为成功候选。当前 `canSubmit=false`、`contractVerified=false`，runner自身也拒绝新提交，没有第二次模型turn。此记录区分官方说明、本机只读检测、软件隔离夹具和真实业务结果。

## 渠道与额度

本机 `codex-cli 0.167.0-alpha.4.1`，`codex login status` 返回使用 ChatGPT 登录。`account/read` 只保留账号类型 `chatgpt`、套餐类型 `prolite`，公开记录不包含身份信息。未读取认证文件、未配置 API Key、未切换付费 API、未购买额度。

[OpenAI 官方图像说明](https://learn.chatgpt.com/docs/image-generation.md)说明内置图像使用 `gpt-image-2` 并计入通常 Codex 用量，图像平均消耗快于相似普通 turn，具体取决于尺寸与质量。这里不把倍率估算成单张精确报价。

10:30 UTC 的只读 `account/rateLimits/read` 回执：`ordinaryUsageAllowed=true`，主窗口 10080 分钟，`usedPercent=33`；积分余额字段 `credits.balance="0"`、`hasCredits=false`。这是账号窗口用量和余额，不是本次人民币或积分收费。每次任务保存调用前、后的官方回执；未返回的人民币、积分和单图费用均为未知。后查询失败时保留图片完成证据，并将用量标记未知，不自动重发生成。

## 官方协议与本机 Schema

[OpenAI App Server 文档](https://learn.chatgpt.com/docs/app-server.md)把 app-server 用作富客户端集成接口，支持 JSONL RPC、会话和增量事件。已读取实际帮助，执行：

```text
codex app-server generate-json-schema --experimental --out <私有目录>
```

本机完整实验性 Schema SHA256：`d9dc3bfe984335642465586c94117e90adb11943c94d8142d0a906221f092e44`。完整 Schema 与私有探测回执保存在忽略目录 `tests/.artifacts/codex-image-contract/`，不提交账号数据。软件每次检查当前安装版 Schema 和已审核版本；升级版本须重新审查工具及 hook 实现。

当前契约的具体使用：

- `initialize` → `initialized` → `modelProvider/capabilities/read`、`account/read`、`account/rateLimits/read`；这些检查不启动模型 turn。功能返回 `imageGeneration=true` 只算检测到能力。
- `thread/start` 使用 `ephemeral=true`、`sandbox="read-only"`、`approvalPolicy="never"` 和本次私有配置。`turn/start` 输入使用真实 `{type:"localImage",path:...}` 附件及提示词，不用 JSON 中的路径代替附件。
- 必须收到 `item/completed` 的 `type="imageGeneration"`、`status="completed"`，以及同任务 `turn/completed` 的成功终态。事件绑定 `id`、`threadId`、`turnId`、真实参考 `inputImages[{path,sha256}]`。`generationId` 可为空，保留实际值，不补造。
- 产物使用事件中实际存在的 `savedPath` 文件，或严格解码事件的 `result` base64。仅有 `fileId` 而无已验证的取回方式时失败；不猜下载地址，不把任意文本路径当图像。文件须通过字节解析、Hash、浏览器实际解码后导入，仍是待人工检查候选。
- App-server 正常关闭和原始事件均保留。取消、超时、中断或失效不自动创建新 turn。RPC 支持大于旧文本通道限制的图片回执，仍有 64MiB 消息上限。

Windows `C:` 工作区可能通过 junction 指向 `D:`，附件比较使用实际文件规范路径并保存原事件值，不能因同文件有两个路径而误判；Hash 校验不因此放松。

## 一次调用、一张图片的本次限制

`turn/start` 没有可靠的 `max_tool_calls=1` 参数。单靠提示词不能限制重试。因此适配器设计了私有 PreToolUse hook；首次实际验收证明，仅检查配置和本地脚本仍不足以证明它在原生执行路径生效。当前入口关闭，不能把该设计或隔离测试当作已验证的实际额度保护。

已审阅官方公开实现：

- [image-generation/tool.rs，rust-v0.167.0](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/ext/image-generation/src/tool.rs)：原生 `image_gen.imagegen` 工具，生成请求不接受模型自定批量 `n`；本次仅允许首次单张请求，不进行后续编辑、细化或重试。
- [extension_tools.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/handlers/extension_tools.rs)、[registry.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/registry.rs)、[tools/mod.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/mod.rs)：图像 Function adapter 经过工具执行前 hook 路径；当前 canonical hook 名为 `image_genimagegen`。
- [registry.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/hooks/src/registry.rs)、[command_runner.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/hooks/src/engine/command_runner.rs)：hook优先使用显式会话shell；只有未指定shell时才回落COMSPEC/cmd。本次实际shell是PowerShell。最初隔离测试只覆盖COMSPEC分支，遗漏此分支，导致原双引号命令在PowerShell中未作为程序调用；此处已更正先前判断。

[官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks.md)要求非托管 hook 精确审查与信任。实现读取 `hooks/list`，要求所有有效来源合计恰好一个私有同步 hook，命令、matcher、启用状态、Hash 均吻合；使用本次 thread config 的 `hooks.state[精确key].trusted_hash`，再次确认 `trustStatus="trusted"`。没有修改全局配置，没有全局 bypass-trust。当前本机原有效 hook 数量实际为 0；早期内部探测曾把响应字符串长度误记为数量，现已读取实际数组并更正，不据此声称有额外 hook。

私有控制文件位于模型只读工作目录之外。以下是脚本正常启动后的逻辑，不能用于忽略启动失败：

1. 拒绝除受控原生图像工具外的所有工具，包括 shell、API 和其他工具包装路径。
2. 核对固定 manifest SHA、实际附件副本 SHA；覆盖工具实际参数，去掉模型自报批量数、提示词与其他路径。
3. 在真正准许图像工具前，从可信 dataRoot 重新创建工作台读取当前存储，运行 `ImageWorkspace.assertExecutablePacket`，重核分镜、目标可执行状态、当前审核、参考文件、绑定和输入快照 Hash。等待期间参考图被拒绝或输入变化则不准执行。
4. 使用 `flag:"wx"` 原子创建唯一调用账本；并发、重试、细化及第二次请求全部拒绝。账本不因取消、超时或重启删除。

Windows启动器已修正为校验过的无空格绝对PowerShell路径、UTF16LE `EncodedCommand`、内部PowerShell字面量引用以及明确UTF8输入输出，适配外层cmd和PowerShell。`tests/codex-image-guard.test.mjs` 的6项隔离测试已通过，覆盖两个shell分支、并发只允许一次、拒绝其他工具及篡改、当前存储变化阻断、精确信任、失败产物保留和自动入口关闭。另在空会话 `SessionEnd` 中通过原生命令执行器验证了独立无操作脚本、真实stdin JSON、中文和空格路径，未运行模型turn。`SessionStart`实际在模型turn开始后才执行，本轮没有为了诊断它而新增turn。

上述修正尚未经新的真实图像任务验收。原生hook错误会继续工具调用的事实仍是明确风险；本轮不通过再次生成来掩盖它。原失败guard目录没有重新执行、补造marker或修改原文。

## 唯一真实调用证据及未完成项

任务 `8eb1182e-5a89-47fe-9220-2e1ea08c1f00`，会话 `01a1dec6-2d54-7ce0-92c8-f02908d619f1`，turn `01a1dec6-2dd8-7502-be10-4438d14271ee`：

- 原生 `hook/completed`：`status="failed"`，原文 `hook exited with code 1`；原目录没有准许marker及脚本日志。工具仍继续，说明不能依赖hook错误自动阻断。
- 实际 `imageGeneration`：`id="exec-76957a5d-1187-4dcf-b165-fca994539d0f"`、`generationId="b2de9922-5394-4374-988d-6be4ecb024b1"`、`status="completed"`；同turn状态 `completed`。有实际savedPath文件及base64产物。
- 实际文件 SHA256：`bbe2683b21c5362a8cd501e322310ad716437c6fe4afb431de7897dd486c6738`。此为真实图像文件证据，不等于本次参考输入、额度保护及自动导入通过。
- 图像事件中实际没有 `inputImages` 字段，无法证明本次要求的参考图被图像工具实际使用；不能用已上传到会话或计划附件清单补造该证据。

当前阻塞是原生执行保护与参考附件证据未通过真实验收。后续须在另行授权的验收范围内验证修正后的实际PreToolUse执行、错误时停止策略及完整附件回执；本轮最多一次调用额度已用完，不重试、不细化、不生成第二张。

适配器失败回执现在保留实际图像事件、原始路径或base64派生副本、Hash、会话、turn及错误，标记 `completed=false`、`verificationStatus="unverified_actual_output"`。业务验证失败与官方turn完成分开记录，保留产物但不导入成功候选、不自动选用。

## 状态边界

只读探测已证明：当前官方登录可复用、图像功能被报告、Schema可读、唯一私有hook的精确信任成功。首次探测的 `contractVerified=true` 曾只基于这些检查；真实验收暴露缺口后已改为 `schemaContractDetected=true`、`contractVerified=false`、`canSubmit=false`。`actualGenerationVerified=false`，不能据此报告自动通道接通。正式四岗位guard、阶段账本和成片验收保持原真实状态。
