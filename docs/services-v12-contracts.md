# v12 多渠道契约与验证边界

核查日期：2026-11-17。下列“隔离通过”表示本地代码与模拟传输通过，不表示真实账号认证、模型资格、官方服务器回执或真实生成。此次没有发起真实文字、图片、视频或语音生成，也没有启动真实 OAuth 授权。

## 独立配置与凭据

`ServiceRegistry` 保存文字、图片、视频、语音四类连接。全局默认和项目覆盖分别保存；项目值 `null` 表示继承。未选择服务时阻断，不隐式改用 Codex、即梦或付费渠道。服务快照在应用任务落盘之前解析，记录连接 revision、模型、参数、费用依据、能力目录版本、Hash。提交前再次核对配置。并发配置改动返回冲突。

密钥单独进入 `credential-vault/*.dpapi`，Windows CurrentUser DPAPI 加密；明文通过子进程 stdin 传递，不进入命令行、前端 GET、项目 JSON 或日志。测试实际运行了 Windows DPAPI，用的是明确的无效测试字符串。非 Windows 环境没有明文降级。外部服务安装、认证、权限、模型目录连接、契约适配与真实生成分别记录。

所有新渠道生成默认关闭。历史即梦只保留原任务查询、下载恢复及已存在的素材和回执；不得把旧积分报价用于新渠道。

## 本轮实现和状态

| 渠道 | 适配内容 | 隔离验证 | 当前真实状态 |
| --- | --- | --- | --- |
| DeepSeek 官方 Responses | Schema 输出、原生 `status=completed`、正文和 usage、同步未知结果保留 | 完成、无效输出、网络中断、并发重复 | 未用真实 Key 验证或生成 |
| OpenAI API 文字 | 独立 Key、Responses、原生状态校验；账号目录 GET | 同一契约处理器 | 未连接真实账号或生成 |
| 本机 Codex 文字 | 保留官方 CLI、新会话执行；各文字岗位使用项目解析器 | 既有任务及兼容回归 | 本轮未调用 |
| Sign in with ChatGPT | 自有应用动态注册、PKCE、nonce/state、JWT 校验、续期、账号目录、文字 SSE | 授权状态机、签名、错误拒绝、终态 | 未启动真实授权，未证明账号资格 |
| OpenAI GPT Image 2.5 | 单张生成；参考图 edits multipart 二进制上传、实际 Hash、下载与解码 | 实际 FormData 字节、PNG 解码、新候选回调 | 无真实 Key 或图片调用 |
| Seedream | 具体型号、参考 URL、原文件 Hash、同步产物处理 | 请求编译 | 未连接；远端素材可访问性仍须实际渠道验证 |
| Wan 3.0 百炼 | 北京空间子域 Endpoint、异步原 ID 查询、下载恢复 | TEST 视频与真实 FFprobe | 未验证账号空间、权限、价格、生成 |
| Seedance 2.5 / flash | 独立规格、首帧 adaptive、互斥参考模式、异步任务 | 原 ID 查询及下载故障恢复 | 未验证账号准入、价格、生成 |
| MiniMax H3 | 原生 v2 创建、`task_id`、query 路径、终态解析 | 原 ID 查询及下载故障恢复 | 未验证账号准入、价格、生成 |
| MiniMax / ElevenLabs 语音 | 见声音模块原生契约与型号裁剪 | 由声音模块隔离验收 | 未发起真实语音 |
| IndexTTS / Qwen3-TTS | 文件检测、独立模型和工作流状态 | 未安装状态、参数编译 | 无已核验运行工作流，不启动或下载模型 |
| ComfyUI / WanGP | 与模型分开；ComfyUI 只读 system_stats 探针、文件及工作流检查 | 配置和阻断 | 不把模型存在当可运行；无核验工作流保持关闭 |

## 真实契约要点

- DeepSeek 的当前型号采用官方目录 `deepseek-flash`、`deepseek-v4-pro`。普通同步 HTTP 用返回正文的 `status` 作为完成依据，记录为 `response.status`，没有伪造 SSE `response.completed` 事件或 CLI `exitCode=0`。下游仍须 Schema 和来源检查。[Responses API](https://api-docs.deepseek.com/api/create-response/)
- OpenAI 图片保留用户指定的 `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare`，不因其他文档显示新型号而替换。参考附件需传实际 multipart 文件；会话或计划中列出引用不代表图像工具实际使用。服务端未返参考使用回执时保存 `null`，画面符合性需人工检查。[Sunburst 型号](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)、[Image API](https://developers.openai.com/api/docs/guides/image-generation)
- Wan 3.0 当前核实北京示例 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`，查询同一空间 `/api/v1/tasks/{task_id}`。没有猜用旧 dashscope 通用域名，也未开放未核实地域。[官方指南](https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide)
- Seedance 标准支持480p/720p/1080p/4k，flash支持480p/720p；标准1080p/4k输出10bit HEVC，浏览器兼容性须按实际文件检查。两者输入图片宽高要求300–6000px、宽高比0.4–2.5。首尾帧要求 `ratio=adaptive`，与多模态参考模式互斥；未接通的编辑/延长组合不伪装支持。[官方 2.5 指南](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)
- MiniMax H3 创建是 `POST https://api.minimax.io/v2/video_generation`；查询是 `GET https://api.minimax.io/v2/query/video_generation/{task_id}`。H3首帧图片宽高要求256–5760px；图生视频画幅为adaptive，纯文生需指定具体画幅。创建回执的 `task_id` 仅代表已受理，不是视频已生成。[创建](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)

## ChatGPT 文字授权

此路线与 API Key、Codex 本机认证、ChatGPT 网页图片权益分开。应用生成一次并保存稳定 host UUID，每次新授权重新生成 state、OIDC nonce、PKCE verifier。只监听 `127.0.0.1` 的 `/auth/callback`，发起后返回官方入口供本人打开，应用不会自行批准。首次使用 `dynamic_agent_client`，实际返回的 client ID 与验证身份绑定；回调不能替换既有注册。身份 token 依据官方 JWKS 做 RS256 签名、issuer、audience、nonce、有效期和返回身份校验。没有文字用量 scope 即使身份有效也不能接通推理。

凭据记录由 DPAPI 加密，刷新按连接串行，不复制 Codex 文件或浏览器 Cookie。账号模型列表读取真实 `models[]`，筛选 `visibility=list`，显示 `display_name` 并以 `slug` 提交。文字请求采用 `store:false`、`stream:true`、上下文数组，不带不支持的工具和字段。只认实际 SSE `response.completed`；中断、失败或 incomplete 不算成功。该授权不开放图片/音视频生成。

依据：[注册与授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[会话与续期](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[账号目录与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[实际 OIDC 配置](https://auth.openai.com/.well-known/openid-configuration)。

## 逐任务费用与提交约束

通用连接价格只供展示，不能直接成为本次批准。媒体任务需要另外记录同渠道、模型、完整请求参数和输入 Hash 的费用依据（`quote`），来源、单位、金额、适用条件和有效期齐全后方能批准。用户手工提供依据会明确标成用户提供，没有官方 quote 接口回执就不称实时官方报价，不编造 quoteId。预算不是报价或绝对结算上限。没有可靠依据则保持待确认。

授权绑定任务 bindingHash、输入 Hash、费用 Hash、单位和预算。稳定 submitId 与跨实例 wx 提交意图先落盘；重复和并发点击不重复 POST。异步任务查询同一外部 ID；查询失败保留 ID。下载失败仅恢复下载；没有任务 ID 的同步未知结果不宣称可恢复查询，也不自动重新 POST。取消只是取消本地等待，不宣称平台退款或服务端取消。URL 参考先下载并核验字节 Hash，证据只证明客户端拿到相同字节，不宣称服务端实际采用。新文件保留，图片和视频分别实际解码后进入候选导入回调，不自动选用。迟到结果维持原任务的输入快照。

## 接口和隔离证据

服务：`GET /api/services?projectId=...`；`POST /api/services/connections`；`PUT /api/services/defaults`；`PUT /api/projects/:id/services`；连接级 POST `credential`、`inspect`、`authorize`。

媒体：项目 `service-tasks` GET / POST 准备任务；单任务 `quote`、`authorize`、`submit`、`query`、`download`、`cancel`。真实运行门槛由后台固定关闭，前端不能切换。

测试文件：`tests/services-v12.test.mjs`、`tests/service-media-v12.test.mjs`、`tests/service-siwc-v12.test.mjs`、`tests/service-http-integration-v12.test.mjs`，共 39 个测试通过。其中 Windows DPAPI 与 FFmpeg/FFprobe 运行真实本机工具，云端和 OAuth 服务全部为隔离传输。TEST PNG / MP4 明确含 TEST FIXTURE / NOT AI，不是模型产物；测试回执不能当作官方必返字段或真实账号证据。
