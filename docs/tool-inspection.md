# 本机接口检查记录

检查时间：2026-11-15，北京时间。机器当前检测结果是开发验收快照；工作台的「工具检测」每次读取本机真实状态，不把快照当作实时状态。

本阶段只执行版本、帮助、命令契约及只读认证/账户查询。没有创建即梦画布、保存远端节点、报价、确认积分、提交生图或视频生成任务，也没有修改登录态。

| 工具 | 已检测到 | 需配置 | 尚未验证 |
| --- | --- | --- | --- |
| Codex 0.167.0-alpha.4.1 | 本机程序；`exec --json`、`--output-schema`、`--ephemeral`、`--sandbox read-only`；`login status` 返回 `Logged in using ChatGPT` | 本次登录态检查通过 | 模型服务网络、模型访问和额度必须通过工作台真实扩写单独确认；见最终验收记录 |
| dreamina 1.4.22 | 本机程序；`text2image`、`text2video`、`multimodal2video` 等公开命令及参数帮助 | `user_credit` 返回「未检测到有效登录态，请先执行 dreamina login」 | 真实生成、人民币成本、运行时模型权限、视频静音控制、自动剧本与分镜文本创作接口 |
| dreamina-canvas 1.2.0 | 本机程序；完整 `schema`；画布、文本/图片/视频/音频/时间轴节点以及导演台命令 | `auth status` 的 `loggedIn=false`（默认 profile） | 画布实际权限、真实生成、文本自动创作、预算报价、无配音输出、导演台导出 |
| FFmpeg 9.0.2 | 可执行程序及 `-version` 成功 | 不在当前 PATH，软件通过实际绝对路径解析后调用；无需为了第一阶段修改系统 PATH | 实际配音、混音、字幕、剪辑和输出编码 |
| FFprobe 9.0.2 | 可执行程序及 `-version` 成功 | 同上 | 对真实媒体的时长和音视频流读取 |

FFmpeg/FFprobe 实际发现于 `D:\AI视频\runtime\ffmpeg\bin\`。Codex 在本机 Codex 应用目录；两个即梦程序位于当前用户的 `bin` 目录。完整实际路径、命令退出码和摘要保存在 [tool-help/inspection.json](tool-help/inspection.json)。未读取或保存认证文件。

## 检查方法与证据

- Codex：`codex --version`、`codex exec --help`、`codex login status`。
- 即梦 CLI：`dreamina version`、`dreamina -h`、`dreamina login -h`、`dreamina user_credit -h`、`dreamina user_credit`、`dreamina text2video -h`、`dreamina multimodal2video -h`。
- 即梦画布：`dreamina-canvas version`、`--help`、`auth status --help`、`auth status`、`node create --help`、`director --help`、`schema`。
- FFmpeg/FFprobe：各自执行 `-version`。

原始命令输出保存在 [tool-help](tool-help/) 中，每份包含实际命令、退出码及输出。完整画布 schema 是已安装程序返回的公开契约；没有从未知端点猜测接口。日志会遮盖密钥形态、认证字段和带查询参数的 URL。

开发沙箱中的部分命令同时报告用户目录日志或 Codex 临时别名目录的 `Access is denied`。帮助和 Codex 登录查询仍成功；这些警告已如实保留在证据中。软件正常在 Windows 用户会话启动后的结果，以界面重新检测和真实任务错误为准。

## 已确认的集成边界

Codex 通过官方非交互 CLI 调用；不复用界面聊天记录、不抓取网页。CLI 事件流用于显示真实任务状态，结构化最终结果用于形成可编辑创作说明。登录态存在只证明本机有认证信息，不能代替实际扩写验收。

`dreamina-canvas node create text` 可以保存给定正文；这不足以证明 CLI 可自动生成剧本。导演台命令中的「分镜」也不能直接认定为用户期待的自动编剧/分镜创作接口。第二阶段必须继续核对实际公开能力，不能用节点保存冒充创作成功。

即梦帮助给出视频模型和参数不代表当前账户可使用，也不构成价格依据。本阶段预算上限只是用户项目约束，没有报价、冻结或扣减任何积分。对于「无配音视频」，需后续确认生成接口是否支持显式关闭语音，或在用户同意的制作流程中对真实媒体做后期处理。

## 可移植配置

检测顺序为明确环境变量、PATH、当前用户 `bin` 和少量已知安装目录；不进行全盘扫描。可设置 `CODEX_BIN`、`DREAMINA_BIN`、`DREAMINA_CANVAS_BIN`、`FFMPEG_BIN`、`FFPROBE_BIN`，值必须是原生可执行文件的绝对路径。FFmpeg 也检查项目相邻的 `runtime/ffmpeg/bin`。

普通 Windows 双击启动时可能没有 Codex 应用注入的 PATH。工作台在上述方式和 npm 包解析均未找到 Codex 后，使用系统 Windows PowerShell 只读查询当前用户注册的 `OpenAI.Codex*` Appx 包，取得 `InstallLocation` 后检查包内 `app/resources/codex.exe`。查询隐藏窗口、2 秒超时、64 KB 输出上限，并缓存 60 秒；不枚举受保护的 WindowsApps 目录、不猜测版本号、不申请管理员权限。若当前账户/沙箱禁止读取注册信息，可继续用 `CODEX_BIN` 明确指定程序。

本次已在普通 Windows 权限下清空子进程 PATH 且移除 `CODEX_BIN` 后验证：找到实际已安装 Codex，`--version` 返回 `0.167.0-alpha.4.1`；首次发现约 804 毫秒，缓存查找约 1 毫秒。测试没有提交模型请求。参见 [无 PATH 发现证据](tool-help/codex-without-path.txt)。

探测通过 `execFile` 的参数数组执行，禁用 shell、隐藏窗口、限制输出和超时。Windows 的 npm Codex 启动脚本优先解析官方包内原生 `codex.exe`；支持新版 `@openai/codex-win32-x64` / `codex-win32-arm64` 可选依赖的 `vendor/<triple>/bin/`、旧版主包 vendor 目录、项目内 `node_modules/.bin` 及 pnpm 符号链接；其他脚本包装器可通过上述环境变量指定实际程序，不执行任意 shell 字符串。布局依据 [OpenAI Codex 官方启动器](https://github.com/openai/codex/blob/main/codex-cli/bin/codex.js) 核对。

已通过临时目录验证新版可选依赖、主包 `vendor/.../bin`、旧版 `vendor/.../codex`、项目内 `.bin` 四种路径解析，并验证明确配置目录而非文件时会拒绝。路径验证使用不执行的占位文件，不作为真实模型调用证据。随后重新运行本机真实工具探测通过。

Codex 帮助检查必须同时包含工作台实际使用的 `--json`、`--sandbox`、`--ephemeral`、`--skip-git-repo-check` 和 `--output-schema` 五项参数；旧版本缺少参数时显示「需配置」及升级说明，不仅凭版本命令成功标记可调用。工作台复用本机现有 Codex 用户配置，不覆盖用户模型、提供商或网络配置。

需要后续认证时由用户在终端执行 `dreamina login` 或 `dreamina-canvas auth login`。工作台不会自动启动授权、刷新凭据或提交媒体任务。

## 本次真实扩写的网络阻塞

本次首笔验收中，Codex 登录状态查询成功，但真实扩写请求出现 `tls handshake eof` 并重连，最终失败。登录态存在与模型服务连接成功是两个独立检查项，首笔不能报告为通过。随后目标工程的第二笔真实调用成功返回六段说明，并完成采用、手动修改和服务重启恢复；两笔历史都保留。具体任务状态与证据见 `validation.md`。工作台环境检测会同时展示最近一次真实扩写的结果，静态帮助证据不代替运行结果。

已只读核对本机相关非秘密配置及代理环境变量是否存在，未读取认证 token，未修改用户配置。没有发现忽略用户配置导致丢失自定义代理或服务地址的证据。开发版本已取消 `--ignore-user-config` 以遵循本机设置，但这属于配置兼容性修正，不宣称已经修复 TLS。

后续网络诊断应区分操作系统代理、模型服务路由和企业 CA。官方支持使用 `CODEX_CA_CERTIFICATE` 或 `SSL_CERT_FILE` 指向受信任的 PEM CA 包；这仅适用于确实存在企业 TLS 代理或私有根证书的网络，不能猜测证书或关闭 TLS 校验。参见 [官方环境变量说明](https://learn.chatgpt.com/docs/config-file/environment-variables)。本次未修改证书或代理设置，也没有为了诊断重复提交模型任务。
