# 第一阶段实现说明

## 范围与组织

AI-Drama-Studio 是独立编写的 MIT 许可工程。本阶段按「项目 → 故事设定 → 创作说明 → 工具环境」组织功能；功能组织参考火宝短剧的公开项目说明，未引入其源码、数据库、素材或业务接口。源码与文档已发布到公开 GitHub 仓库 [499893181-lang/AI-Drama-Studio](https://github.com/499893181-lang/AI-Drama-Studio)；应用仍为本机服务，没有发布在线工作台或桌面安装包。

前端是原生 HTML/CSS/JavaScript，后端使用 Node.js 内置 HTTP、文件系统和子进程模块。没有 npm 运行依赖、数据库服务或构建步骤。运行要求 Node.js 22+；本机已实际使用 Node.js 24。

| 文件 | 职责 |
| --- | --- |
| `src/server.mjs` | 本机 HTTP、接口校验、受控附件下载、启动和数据目录锁 |
| `src/store.mjs` | 项目事实、输入校验、revision、防覆盖、原子写入与上一版备份 |
| `src/codex.mjs` | 官方 CLI 调用、任务事件、超时/取消/失败、候选结果 |
| `src/tools.mjs` | 真实版本/帮助/只读认证探测，带超时及日志脱敏 |
| `public/` | 中文工作台、项目列表、手动保存、六段说明、候选采用、环境检测 |
| `tests/` | 存储/HTTP集成验证及真实 Chrome CDP 浏览器验收 |

## 项目与持久化

`data/projects/<UUID>.json` 是单个项目的当前事实来源；包含名称、原始构思、时长、横竖屏、画风、预算、附件元信息、创作说明、来源及修订号。保存流程是写入同目录临时文件、fsync、复制原文件为 `.bak`，最后 rename 替换。损坏文件保留并报告，不自动覆盖或静默丢弃项目。

所有用户编辑请求携带当前 revision；版本过期返回 409。不同服务不能同时使用同一 `DATA_DIR`，启动以 `studio.lock` 防止并行写入。备份应在停止服务后复制整个数据目录；`.bak` 只保留上一版，不能替代完整备份或多版本历史。

参考素材复制到 `data/references/<project UUID>/<reference UUID>.bin`，原始文件名只存元数据；最多20个文件，每个25MB。下载使用 attachment 与 `nosniff`，不在页面执行上传文件。移除附件只解除关联，原二进制保留供恢复。本阶段模型只接收附件名称、类型与大小，不分析附件内容。

## 真实 Codex 边界

使用官方支持的 `codex exec --json --sandbox read-only --ephemeral --skip-git-repo-check --output-schema <schema> -`，通过标准输入传递提示词和 JSON 项目资料。没有 shell 拼接，也不要求把 API 密钥存到工程。复用本机认证与用户模型配置，不读取 token。

每次扩写先实际执行 `codex login status`。未安装、未认证、子进程错误、网络失败、超时、非零退出或不完整/不合法结果均形成真实失败任务；不会填入预设创作说明。`thread.started` 和 `turn.started` 仅表示会话/处理开始，不能算扩写成功。必须有完成事件、成功退出和六段结构校验才提供候选。网络重连事件保留为记录；只有最终成功状态才能采用。

任务保存在 `data/jobs/<UUID>.json`，界面轮询真实事件而不是显示模拟百分比。每项目只允许运行一个任务，整个工作台最多同时两个；五分钟超时，支持取消，关闭后未完成任务标记中断，不自动重试。运行目录和Schema在 `data/runtime/`，不入 Git。

结果包含故事梗概、背景、人物关系、核心冲突、情绪发展、结局，以及「保留的用户内容」「AI补充设定」。原始构思独立保留；模型补充有清晰标记，用户仍须审阅语义是否符合要求。候选在用户点击采用后写入说明，并允许后续编辑。采用时核对输入哈希和当前revision；期间改变故事要求时拒绝使用旧候选覆盖新要求。不会把模型返回本身当作独立剧情审稿PASS。

## 本地接口与安全边界

服务仅绑定 `127.0.0.1`，限制 Host 和 Origin，拒绝跨站请求；没有远程访问或多用户账户。本机其他程序仍可访问该本地服务。页面通过 CSP 限制脚本和资源来源，所有用户/模型文字在显示时转义。

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | 服务健康与版本 |
| `GET/POST /api/projects` | 列表/创建 |
| `GET/PUT /api/projects/:id` | 读取/版本化保存 |
| `POST /api/projects/:id/references` | 原始二进制上传；`X-File-Name` 使用URI编码 |
| `GET/DELETE /api/projects/:id/references/:refid` | 下载/解除关联 |
| `POST /api/projects/:id/expand` | 显式发起真实扩写 |
| `GET /api/jobs/:id` | 真实状态、错误、候选及事件 |
| `POST /api/jobs/:id/apply` | 显式采用候选 |
| `POST /api/jobs/:id/cancel` | 取消运行中任务 |
| `GET /api/tools` / `POST /api/tools/refresh` | 工具检查/重新探测 |

## 尚未实现

没有即梦媒体提交、自动剧本/分镜创作、预算报价或扣费硬限制、配音、字幕、剪辑和视频导出。预算字段当前只记录人民币计划上限，不限制 Codex 服务的账户用量。没有多用户协作、桌面安装包、项目删除或通用导入恢复界面；项目恢复通过数据目录备份完成。Windows 已验证，其他平台尚未实测。

集成依据：[官方非交互模式](https://developers.openai.com/codex/noninteractive)、本机实际帮助（见 `tool-help/`）、[火宝短剧公开功能组织](https://github.com/chatfire-AI/huobao-drama)。
