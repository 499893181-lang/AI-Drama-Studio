# v12 实施与验收记录

2026-11-17。基线 `1e70fdaf2ed82f768ee3d02fe1d56b40d51b94e1`，独立实施分支 `codex/studio-services-voice-editing-20261117`。保留前序 PR 依赖，不合并历史 PR。

工作台入口：[本机 4321](http://127.0.0.1:4321/studio.html?page=services)。本机复用原治理数据，未另造空数据目录重置额度。另一台电脑需要按 [启动说明](studio-services-v12.md) 本地运行；此地址不是公开部署地址。

## 实际完成与证据边界

| 项目 | 本轮结果 |
|---|---|
| 完整回归 | `node --test tests/*.test.mjs`：408/408 通过，0 失败、0 跳过；新增来源/目录、渠道、OAuth、媒体故障、音频、裁切、混音、字幕、草稿及旧行为回归。 |
| 页面/构建 | `node scripts/check-ui.mjs`：16 JS / 10 HTML 的语法、引用、共享布局检查通过；所有 src 模块单独 `node --check` 通过，diff 空白检查通过。 |
| 旧行为与新外壳 | 56 项 Chrome 检查：故事保存、项目切换、剧本四标签/长文分页/检查/确认、分镜、历史、手工媒体页、六加六导航、1440×900、1366×768、390 窄屏、语言与主题。来源是隔离 TEST 项目。 |
| 新目标助手 | 6 项 Chrome 检查：上下文、多轮、对照/应用、撤销、设置白名单、项目隔离；使用隔离 runner，不是本账号真实对话。 |
| 实际本地媒体 | 6 项 Chrome 检查，TEST 音频 2 秒和 TEST MP4 6.52 秒实际解码播放；既有计划修改、刷新、声音变化需复核、服务重启及独立 BGM 上传/检查/选用/播放通过。 |
| 复用原数据 | 新服务 10 个只读 Chrome 页面/尺寸检查通过，控制台异常 0。默认启动不传 DATA_DIR 仍恢复原目录；原 570 个文件 Hash 不变；原图像额度 1/1、剩余 0，自动出图关闭；原失败任务仍 failed/result=null。 |
| 剪映草稿 | 锁定依赖实际生成唯一 TEST 草稿，素材副本/引用、裁切、字幕及轨道可读；11.8 打开/渲染未验证，自动导出关闭。 |
| 正式岗位 | 正式 guard 与账本保持原状态；当前仍 not_checked，不称前期包或成片最终 PASS。 |

原始脱敏记录：[浏览器回归](studio-v12-evidence/browser-regression.json)、[目标助手](studio-v12-evidence/studio-assistant-v12-browser.json)、[界面语言盘点](studio-v12-evidence/i18n-inventory.json)、[本机原数据只读浏览器](studio-v12-evidence/live-original-data-browser.json)、[本地导出/草稿](studio-v12-evidence/production-local.json)、[媒体浏览器](studio-v12-evidence/production-browser.json)、[原文件与调用额度保护](studio-v12-evidence/preservation.json)。

所有云端请求/响应及 OAuth 授权均由隔离传输验证。实际运行本机工具限于只读检查、TEST 图片裁切、TEST 音视频解码/本地剪辑及独立剪映草稿；没有真实文字、图片、视频或语音模型生成，没有 node confirm/run，没有新增消费。实际账号资格、可用额度或费用不从测试回执推断。

## 布局前后与主要页面

下面全部使用明确 TEST / NOT AI 项目或测试素材；人像缺失时显示真实空状态，没有用示例脸冒充已经生成的角色。

| 页面 | 截图 |
|---|---|
| 改版前：v11 双侧栏，独立 TEST 稿 | [改版前](studio-v12-evidence/before-v11-script.png) |
| 剧本 / 分镜（隔离 TEST 候选，非真实生成） | [剧本正文](studio-v12-evidence/script-1440x900.png) · [分镜编辑](studio-v12-evidence/storyboard-1440x900.png) |
| 改版后：声音页 1366×768，翻句/表演/操作说明首屏可见 | [声音 1366](studio-v12-evidence/voice-1366x768.png) |
| 声音页 1440×900 | [声音 1440](studio-v12-evidence/voice-1440x900.png) |
| 角色与场景并列 | [人物场景](studio-v12-evidence/entities.png) |
| AI服务配置 | [服务](studio-v12-evidence/services.png) |
| 画风 / 导演预设 | [画风](studio-v12-evidence/style.png) · [导演及规则](studio-v12-evidence/directors.png) |
| 提示词 / 统一视频子页面 | [提示词](studio-v12-evidence/prompts.png) · [视频准备](studio-v12-evidence/video.png) |
| 多轨剪辑 / 实际字幕帧 | [剪辑](studio-v12-evidence/editing.png) · [1.5 秒字幕](studio-v12-evidence/editing-test-caption-at-1p5s.png) |
| 实际 TEST 音视频播放 | [音频](studio-v12-evidence/voice-test-audio-playback-1440.png) · [MP4](studio-v12-evidence/editing-test-mp4-playback-1440.png) |
| 独立 BGM 与需复核 | [独立声音](studio-v12-evidence/editing-independent-test-bgm-selected.png) · [修改后复核](studio-v12-evidence/voice-stale-after-performance-change-1366.png) |
| 设置、深色英文及存储 | [通用](studio-v12-evidence/general.png) · [深色英文](studio-v12-evidence/general-dark-en.png) · [保存位置](studio-v12-evidence/storage.png) |
| 助手建议 / 应用与撤销 | [建议对照](studio-v12-evidence/visual-proposal-before-apply.png) · [应用记录](studio-v12-evidence/visual-applied-with-undo.png) |
| 窄屏抽屉与固定助手输入 | [窄屏](studio-v12-evidence/voice-narrow.png) |

## 尚未验证 / 阻塞

- 各云账号未在本轮真实授权、调用生成或核验本次费用；连接、目录、资格和真实生成分开。真实执行门保持关闭，费用未知不显示免费。
- SIWC 实现官方独立授权链，未发起真实授权；本机 Codex 既有认证不作为 SIWC 或图片 API 认证。ChatGPT 图片 API 权益不得由订阅推断。
- IndexTTS/Qwen3-TTS、ComfyUI/WanGP 未发现已核验的模型/工作流组合，不自动下载，不宣称可执行。
- 剪映 11.8 实际打开、渲染与导出尚未验收；已创建 JSON 不等于已打开。FFmpeg 本地 MP4 路径实际可用。
- 图像参考使用、镜头遵循、人物连续性、配音表演、对口型和真实成片质量不在 TEST 软件验收结论内。
- 历史正文、知识资料、模型回执和诊断原文按来源保留；界面语言切换不翻译这些证据。

下一次真实调用另见[待授权方案](studio-v12-real-acceptance-plan.md)，本轮没有执行。
