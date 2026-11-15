# 即梦短剧创作 CLI 公开能力复核

检查日期：2026-11-15（Asia/Shanghai）。本次只读取官网公开安装说明、安装器、官方制品README、实际命令帮助与Schema；没有安装到全局、修改现有CLI、创建画布、提交剧本或媒体任务。

## 结论

即梦官方现已提供独立的 **短剧创作CLI `jimeng-novel`**。它与本机旧有 `dreamina`、`dreamina-canvas` 不同。实际命令与Schema已经确认 **AI分集大纲生成、AI单集剧本生成、剧本任务查询**；这比文本节点保存多了一条真正的AI剧本入口。

当前公开命令不能证明存在 **对当前剧本原位进行Agent修改、按审稿意见修订、剧本诊断** 的独立接口。`script episode --requirement` 可给本集生成附加要求，但不能据此承诺它会在已有稿件/任务版本上执行定向修改。`previous_script` 明确表示上一集原文，不能冒充当前稿修改参数。`node update` 与画布 `node edit text` 都只保存调用方提供的正文，不能当作Agent改写成功。

本轮并未调用剧本服务，因而没有“已接入/已生成成功”的结论。官方指南中没有被实际取回的内容也未充当证据。

## 来源与版本

1. [即梦官方安装页](https://jimeng.jianying.com/ai-tool/install?from_page=banner)现在区分“短剧创作CLI”和“全能画布CLI”。短剧卡片宣称剧本创作与诊断，并链接到新的 `/novel-cli`，旧 `/cli` 不是这一入口。
2. [官方短剧安装入口](https://jimeng.jianying.com/novel-cli)实际返回安装器文本。这里只下载阅读，未执行 `curl | bash`。它当前指定制品 `toutiao.capcut_business.dreamina_novel_cli_1.0.0.192.tar.gz`。
3. 制品内 `build-info.txt` 显示程序版本 `1.0.6`、commit `5893c6a792725ef5fc1b8425e118c3e6d73db641`、流水线号 `scm-version:1.0.0.192`；实际 `jimeng-novel --version` 一致。**1.0.0.192是制品流水号，1.0.6是CLI程序版本，不构成版本冲突。**
4. 官方Windows制品 `jimeng-novel-1.0.6-windows-amd64.zip` 的SHA256为 `03c09473269c14f2c73a553ad9a89525c7860d431e016d39b71506571e2cb7c9`，与归档内 `checksums.txt` 相符。程序及其 `runtime/` 在隔离工作目录保持完整，仅执行帮助、Schema及登录状态查询，没有复制到用户bin或注册Skill。
5. 官网页面给出的[短剧CLI详细指南](https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg)未能通过网页读取工具取回；不声称已阅读该指南。安装入口、制品README与本地实际帮助已成功读取，可以独立支撑下述命令事实。

官网安装页为JavaScript页面，本次直接渲染未呈现正文。安装入口及指南URL从该页实际加载的公开安装卡片资源中核实，仅提取公开命令与链接，没有探测或调用隐藏业务接口。来源及制品摘要在 `evidence/artifact-provenance.json`、`evidence/official-links.json` 中。

## 三个CLI的边界

| CLI | 实测版本 | 本次实际观察 |
| --- | --- | --- |
| `dreamina` | 1.4.22 | `-h`列出登录、账户、图像/视频生成与任务查询，没有公开剧本子命令 |
| `dreamina-canvas` | 1.2.0 | `schema`中 `node create text`、`node edit text` 明确“不触发生成”；模型类型为image/video/audio，不能据此推断文字Agent接口 |
| `jimeng-novel` | 1.0.6 | 实际 `script --help`列出 `outline`、`episode`、`result`；相应 `schema get` 均本地成功返回契约 |

新CLI `status -j`本次返回 `{"logged_in":false}`。其 `status --help`说明SDK在已有凭据时可能刷新；本次无可复用登录态，没有执行它的login，也没有发起第三条授权流程。旧两个CLI的本轮最终认证结果由主检查记录分别列出，不能从一个工具的登录状态推断另一个已登录。

## 准确调用方式：AI生成

下列是依据实际帮助和Schema整理的 **待执行示例**，本次没有提交。`<即梦画布ID>`必须来自即梦服务，不是AI-Drama-Studio自身的项目UUID。也可以在已绑定 `.jimeng/config.json` 的目录中使用默认画布；本次没有新建或绑定画布。

本次是隔离读取发行包，`jimeng-novel`尚未加入PATH。实际执行时可使用完整发行目录中的exe绝对路径（PowerShell用 `& $Novel ...` 调用）；exe必须与随附 `runtime/`保持原发行结构，不能只复制一个exe。正常安装方式以官网当前安装器/README为准，不沿用旧dreamina的安装路径。

先核对契约：

```powershell
jimeng-novel --version
jimeng-novel script --help
jimeng-novel schema get --command "script outline" -j --full
jimeng-novel schema get --command "script episode" -j --full
jimeng-novel schema get --command "script result" -j --full
```

生成单集分集大纲：

```powershell
jimeng-novel script outline --project-id <即梦画布ID> --episode-num 1 --idea-file creative-brief.md --script-localization cn --request-id <本次UUID> --wait 120 --out outline.md -j --full
```

大纲输入JSON只允许 `episode_num`、`idea`、`ref_content`、`model_key`、`script_localization`。`episode_num`必填且1–100，`idea`与`ref_content`至少一项非空。`model_key`省略使用CLI默认 `script_bird`，不擅自把宣传名称DreamScript当作可传模型key。

生成单集剧本：

```powershell
jimeng-novel script episode --project-id <即梦画布ID> --current-episode 1 --story-engine-file story-engine.md --characters-file characters.md --current-episode-summary-file episode-01-summary.md --world-setting-file world-setting.md --requirement-file episode-01-requirements.md --script-localization cn --request-id <本次UUID> --wait 120 --out episode-01.md -j --full
```

`script episode`必填字段是 `current_episode`（至少1）、`story_engine`、`characters`、`current_episode_summary`。可选字段为 `world_setting`、`history_summary`、`previous_script`（上一集）、`future_summary`（后续最多三集）、`plot_positioning`、`requirement`、`stage_content`、`stage_episode_range`、`stage_sequence`、`model_key`、`script_localization`。对应文件入口是相应 `--...-file` 参数；高级入口为 `--input-file <JSON文件>`。

两份不含用户数据的UTF-8示例：[outline-input.example.json](examples/outline-input.example.json)、[episode-input.example.json](examples/episode-input.example.json)。可将上面生成命令的各文本参数替换为对应 `--input-file examples/episode-input.example.json`（或outline示例），仍须提供明确画布ID与本次幂等键。示例仅用于说明Schema，不是已提交任务或生成结果。

例如 `episode-01-requirements.md`可写目标30秒、角色及结局锁定、只写剧本不生成媒体等具体要求；这些要求是文字约束，不是CLI额外定义的预算或时长字段。输入Schema `additionalProperties:false`，不能将工作台完整项目JSON直接原样传入。

查询已接受的剧本任务：

```powershell
jimeng-novel script result --thread-id <原thread_id> --run-id <原run_id> --wait 120 --out episode-01.md -j --full
```

帮助说明初次提交返回 `thread_id`、`run_id`、`requestId`；`status=running`即使exit0也只是未完成，须沿原任务查询，不换幂等键反复提交。`--out`声明不会直接覆盖内容不同的文件，而会将旧文件放入同目录 `old/`。这只是CLI文件行为，尚未进行真实服务验收。

JSON通用信封为 `{status,data,error,context}`。当前Schema对剧本结果正文并未给出完整字段类型，因此下游实现须保存实际回执并验证成功终态、正文与锁定要求，不能仅凭退出码、空结果或任务ID判完成。

## 修改能力的确切边界与阻塞

- 实际 `script --help`仅列出outline、episode、result；对应Schema没有当前稿ID、当前稿版本、审稿feedback或原位修改操作。不能虚构 `script edit/revise/diagnose` 命令。
- `--requirement`支持生成时附加要求。重新调用episode可形成新候选，但能否把当前稿作为受保护的编辑基础、能否逐条执行返工意见，未在本次公开契约中证实；它也会是新的实际调用，不能暗中当作免费修改。
- `jimeng-novel node update --input-file ...`的Schema含 `text`，属于保存给定文本；不是调用剧本Agent。`dreamina-canvas node edit text`更直接注明“不触发生成”。
- 官方安装页宣传“剧本创作与诊断”，但本制品CLI没有公开独立诊断子命令。需取得可访问的官方详细指南、更新版CLI契约或官方明确支持的修改接口，才能确认这部分集成。
- 新CLI未全局安装/认证，未选择用户即梦画布，也未实际提交剧本任务；因此当前可交付的是准确公开调用契约，不能报告完成真实剧本接入。后续如执行，需先明确目标项目/空间、认证和调用授权，再以真实任务回执验收。

## 可提交的脱敏证据

只提交本报告、`examples/` 中的自建示例与 `evidence/` 中的版本、help、公开Schema和摘要JSON。隔离下载的66MB全平台归档、Windows程序与runtime、官方网页HTML/JS、空浏览器profile和安装器正文均不应进入AI-Drama-Studio仓库。没有保存或提交token、cookie、设备码、账号身份或用户项目内容。所有服务端ID示例都使用占位符，未将未执行命令伪报为实测成功。
