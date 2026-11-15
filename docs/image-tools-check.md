# 图像工具只读核查（2026-11-15）

本次依据OpenAI官方文档和实际本机帮助分别核对，不提交图像或其他生成任务，不读取认证文件，不安装SDK或切换付费服务。

| 证据 | 实际结果 | 能证明的范围 |
| --- | --- | --- |
| `codex --version` | `0.167.0-alpha.4.1` | 本机官方CLI已安装 |
| `codex login status` | 退出0，`Logged in using ChatGPT` | 当前CLI账号登录；不证明图像权限、余额或本次费用 |
| `codex features list` | `image_generation stable true` | 本机配置开启图像功能；不是一次真实图像完成回执 |
| `codex --help` / `exec --help` | `--image`用于附加输入图片 | 参考图输入参数，不能拿来冒称独立图像输出API |
| `codex app-server --help` | 可运行，说明提供本地服务与Schema生成命令 | 帮助存在不代表工作台图像适配完成 |
| PATH中独立 `openai` 命令 | 本次未检测到 | 仅说明该搜索范围；没有检查或配置API认证 |

[OpenAI图像创作说明](https://learn.chatgpt.com/docs/image-generation)提供Codex图像创作方式，并说明会使用账号额度；程序化图像生成另有API路线。[官方API CLI文档](https://developers.openai.com/api/docs/libraries/openai-cli)公开 `openai images generate`，结果需要按接口返回保存。本次只核查文档与本机help，没有验证该API的账号资格、认证、实际调用与产物。

因此不能报告“官方没有图像能力”，也不能报告“本机Pro已经接通工作台图像API”。当前证据等级为**文档支持、本机功能已检测、自动生成未验证**。软件提供 `/api/images/capabilities` 的只读检测、手工任务包导出及实际图片导入。没有自动生成入口，不读取Cookie或代替用户发送网页消息。

费用状态为**费用待确认**，金额、单位与币种均为空；没有构造零价、积分兑换率或官方报价编号。ChatGPT网页、Codex账号及API渠道分别核实，既有登录或订阅不能当作本次免费凭证。用户在官网核对权益与费用后自行决定是否出图，软件只接收主动导入的实际文件。

完整只读帮助保存在本机忽略目录 `tests/.artifacts/image-v05/codex-image-help.json`；公开验收只保留命令、退出码及必要的图像相关行。此核查不影响现有文字创作，不会发起即梦画布、视频、配音或剪辑任务。
