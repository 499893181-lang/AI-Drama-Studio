# 本机 Codex 文字与分镜工作台（0.3.0）

本轮以 `0c938971219f61e54b4e3e15ea7e1df9880be61a` 为基线，独立分支为 `codex/creative-workbench-v04-20261115`。保留原有立项与即梦文字页面，新增 `/creative.html`，默认以本机已登录 Codex 完成文字任务。此路径不检查即梦画布、不读取即梦报价、不提交媒体任务。

## 启动与操作

```powershell
# 在本分支的独立 worktree 中启动，端口可与旧服务并存
.\scripts\start.ps1 -Port 4318
```

打开 `http://127.0.0.1:4318/creative.html`。先选择已有项目，或在立项页新建项目并保存构思。创作工作台依次保存当前要求与事实锁、生成剧本候选、选择导演与作品级预设并编辑镜头、生成分镜候选、启动新会话独立审阅。候选不会自动成为采用稿；人工核对后采用，人工编辑另存新版本。

导演库包含15位导演、17个作品级预设；来源、适用范围和误用提示随选择展示。90条手册扩展只按显式勾选使用，案例限定规则默认关闭。静态首帧、动态摄影及后期声音分别编辑；声音计划留待后期，前期视频提示词要求无对白、旁白及背景音乐。提示词或任务包导出只是文字文件，不会调用图像、即梦画布、视频或声音服务。

## 任务、稿件与采用

沿用现有文件存储的临时文件、fsync、备份及原子替换机制；新任务和工作区使用独立数据目录项，不迁移旧项目。每次执行保留输入快照、revision、上游/镜头/预设/知识Hash、请求ID、真实会话ID、原始输出与校验结果。只有退出码0、真实完成事件和完整结构有效的正文才显示候选成功。

工作区、不可变版本及活动索引位于 `data/creative-workspaces/`，任务在 `data/creative-jobs/`，完整输入与原始回执在 `data/runtime/creative/<任务ID>/`。人工剧本保存会选中新版本作为下游来源，同时继承当前实体及镜头输入快照，保留AI补充来源；旧候选不再占据来源。分镜候选需显式载入编辑区才能修改，采用本身保留原镜头输入。导出的 `packets/prompts` 对应当前保存输入，`adoptedStoryboard` 单列已采用稿，避免混淆。

重复请求不会静默新建同一输入的执行；重启把未结束的本地任务明确标为中断，不自动重新提交。失败的正文与原始回执保留。采用前从当前服务端存储重新读取项目及镜头，再编译并核对当前Hash；旧任务与旧回答彼此匹配不足以通过采用。采用及人工保存追加不可变版本，原人工稿保留。

创作、分镜与审阅各自使用新的 `codex exec` 会话，不使用 `resume`，不向审阅会话提供创作的聊天历史。审阅六类为用户要求、动机、逻辑、时长、连续性与制作难度，逐项保存证据及问题；它是独立候选审阅，不是正式四岗位发布。上游、镜头、预设或知识改变后，旧候选及旧报告标记需要复核。

## 真实能力边界

界面分别显示工具/认证、能力证据、执行、候选、正式阶段、媒体六类状态。正式四岗位guard、15份生产文件与原账本尚未接入软件，因此正式阶段保持 `not_checked`，媒体保持 `not_generated`。模型返回的PASS不会改变这些状态，也不会创建假的正式文件或重置任何正式返工预算。

Codex沿用本机登录与用户配置；账号额度由官方工具管理，不推断调用免费，也不切换到API或另购服务。本轮确认的官方调用方式见 [OpenAI非交互文档](https://learn.chatgpt.com/docs/non-interactive-mode)：`exec --json --sandbox read-only --ephemeral --skip-git-repo-check --output-schema <schema> -`。应用保存完成事件，并独立验证业务结构，认证失败显示待配置。

数据、认证与完整原始任务均留在本机；公开验收记录只包含非个人故事和脱敏的状态、Hash及证据。测试和真实调用结果分别见本分支验收记录，不能用隔离夹具证明模型成功或媒体已生成。

## 验证与调试

```powershell
node --test tests/*.test.mjs
node tests/creative-browser-smoke.mjs
node tests/script-browser-smoke.mjs
# 以下两项需要单独启动4318的独立测试服务，不应指向个人工程数据
# 显式真实调用账号文字额度；重复执行优先读取已有任务，不自动重提失败任务
node scripts/verify-creative-real.mjs --run-codex
node scripts/verify-creative-live-ui.mjs --adopt
# 重启同一独立测试服务后只检查恢复，不发送任何模型任务
node scripts/verify-creative-real.mjs --restore
```

本轮分开的隔离、Chrome与真实模型证据见 [独立验收](creative-workbench-acceptance.md)。HTTP接口位于 `/api/creative/knowledge`、`/api/projects/<id>/creative`（读取与保存）、其下的 `/tasks`、`/adopt`、`/versions`、`/export`，以及 `/api/creative-tasks/<id>` 和 `/cancel`。任务提交与采用均在服务端读取当前项目，客户端不能提交可信Hash或伪造候选结果。
