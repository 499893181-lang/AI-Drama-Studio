# AI-Drama-Studio

Windows 本地运行的中文 AI 短剧故事立项工作台。当前版本只完成第一阶段：保存故事构思与制作要求，通过本机真实 Codex 扩写创作说明，再由用户编辑和保存。

## 启动

需要 Node.js 22 或以上版本。项目不依赖 npm 包，不需要安装数据库。启动脚本优先使用 `NODE_BIN` 或 PATH 中的 Node.js；若没有独立安装，会自动发现并复用已安装 CodexPrimaryRuntime 中的 Node.js，不下载或复制运行时，也不修改全局 PATH。

双击项目根目录的 `start.cmd`，或在 PowerShell 中执行：

```powershell
.\scripts\start.ps1
```

也可以直接运行：

```powershell
node .\src\server.mjs
```

打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。按 Ctrl+C 停止服务。端口被占用时，可执行 `.\scripts\start.ps1 -Port 4318`。

只检查启动环境而不启动服务，可运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1 -CheckOnly`。如自动发现受本机权限限制，可先设置 `$env:NODE_BIN = 'C:\实际路径\node.exe'` 再启动。脚本使用 UTF-8 BOM，兼容 Windows PowerShell 5.1。已安装 Codex 运行时若被移除或升级，脚本会重新发现路径；找不到时明确报告配置问题。

## 已完成功能

- 中文项目列表、新建与编辑，目标时长默认 30 秒，可修改时长、横竖屏、画风、预算上限及参考素材。
- 项目存放在本地，关闭网页或重启服务后可恢复；手动保存并显示未保存状态。
- 通过官方 `codex exec` 非交互接口调用本机 Codex，显示真实任务状态、错误与候选结果。
- 创作说明包含故事梗概、背景、人物关系、核心冲突、情绪发展和结局，并单列用户指定内容与 AI 补充设定。候选经用户采用后进入可编辑稿。
- 检测 Codex、即梦 CLI、即梦画布 CLI、FFmpeg 等本机工具，并区分检测证据、待配置和未验证能力。
- 第一阶段以外的流程只作路线展示，尚未实现媒体制作与视频导出。

## Codex 配置

先在终端运行 `codex --version` 与 `codex login status`。如果没有登录，请由用户在自己的终端执行 `codex login` 并完成认证，再回到工作台刷新工具检测。

工作台复用本机 Codex 的认证，不要求将 API 密钥写进项目。调用失败会显示真实错误，不会填入示例扩写。创作构思会通过本机 Codex 提交给其模型服务；预算上限是项目计划字段，当前阶段不代表 Codex 账户的自动扣费限制。

Codex 使用只读沙箱执行独立的文字扩写任务。接口依据：[官方非交互模式文档](https://developers.openai.com/codex/noninteractive)。具体参数以已安装版本的 `codex exec --help` 为准。

可通过环境变量指定工具可执行文件路径：`CODEX_BIN`、`DREAMINA_BIN`、`DREAMINA_CANVAS_BIN`、`FFMPEG_BIN`、`FFPROBE_BIN`。服务端端口使用 `PORT`；项目数据目录使用 `DATA_DIR`。例如：

```powershell
$env:CODEX_BIN = 'C:\path\to\codex.exe'
$env:DATA_DIR = 'D:\AI视频\AI-Drama-Studio-data'
node .\src\server.mjs
```

## 数据与开发

默认数据目录为项目根目录的 `data`。备份时停止服务，复制整个数据目录；恢复时将其放回原位或设置 `DATA_DIR`。数据、运行缓存、密钥和大型生成媒体均已排除在 Git 之外。不要将个人认证文件加入版本库。

工程使用原生 Node.js HTTP 服务与浏览器前端；核心代码独立编写。功能组织参考[火宝短剧](https://github.com/chatfire-AI/huobao-drama)的项目、创作、分镜、生产流程划分，没有复制其业务源码或资源。

接口实测与能力边界见 `docs/tool-inspection.md`，开发验证结果见 `docs/validation.md`，后续任务见 `docs/next-stage.md`。这些记录以本机实际执行结果为准；即梦本阶段只读取帮助和状态，没有提交图片或视频生成任务。

许可为 MIT，见 `LICENSE`。
