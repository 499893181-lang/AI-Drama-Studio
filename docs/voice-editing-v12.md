# 声音与多轨剪辑 v12

本轮模型生成请求为 **0**。本地验收使用仓库标明 TEST FIXTURE / NOT AI 的视频、图片及 FFmpeg 正弦音；测试音不是 AI 配音，技术检查不等于内容通过。四岗位正式门禁仍为 `not_checked`。

## 声音

已确认剧本提供人物稳定ID和来源；声音卡、台词稿及音频候选分别版本化。初次进入仅整理现有人物摘要，音色ID保持空，保存后才形成声音版本。年龄变体可共享人物ID但使用不同声音卡ID。用户的表演说明单独保存；未经支持的说明不冒充实际发送参数。

MiniMax 适配 `/v1/t2a_v2` 非流式hex音频，核实 `base_resp.status_code=0`、`data.status=2` 和完整音频后还须实际解码。`trace_id` 只是诊断编号，不作为可查询异步任务ID。2.8可发送部分emotion；whisper/fluent限当前已核实的2.6型号。[官方Schema](https://platform.minimax.io/docs/api-reference/speech-t2a-http.md)

ElevenLabs使用具体 `voice_id` 的音频响应；模型及音色资格须由账号目录核实。没有把通用自然语言指令、SSML或pitch参数无条件塞入请求。[官方接口](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

IndexTTS / Qwen3-TTS保留独立服务选择与已验证本地runner注入接口。尚无已验证服务/模型/工作流时阻断生成，不安装权重，不因技能存在而显示TTS已接通。

生成意图先落盘并有独占marker；区分应用提交意图和外部POST尝试。同步请求结果未知不自动POST，无轮询ID不假装支持恢复查询。迟到音频保留原绑定，人工检查与选用分开。音频文件Hash、真实FFprobe和完整解码均保存；目标与实测时间分列，不暗中变速或声称对口型。

## EditPlan v2

原v1完整片段拼接接口保持可用。v2的裁切、时间位置、字幕、对白/旁白/BGM/音效、音量、淡入淡出及fade转场全部使用整数微秒。视频和音频必须来自当前有效且人工检查、选用的候选，保存不可变来源快照。源文件、审核或选用改变后计划需复核。

背景音乐、音效和外部旁白有独立本地素材导入入口，保存来源说明、实际解码、Hash和实测时长，经过人工检查与选用后才能加入轨道；不要求创建虚假的人物或台词。替换形成同一素材族的新版本，保留原文件、审核和选用记录；拒绝或换选后依赖计划需复核。它们与模型配音候选分开标记，TEST正弦音不冒充配乐授权或AI配音。

v2导出明确重编码派生：按实际裁切、缩放加黑边、叠层淡化、混音和ASS字幕制作MP4，保留原片与旧导出。记录完整无shell命令、FFmpeg版本、输入Hash和输出probe，再执行完整输出解码。FFmpeg9使用 `-/filter_complex <file>`；不使用已经移除的 `-filter_complex_script`。当前转场限定相邻片段的明确重叠fade；不声称支持任意剪映效果。[FFmpeg过滤器](https://ffmpeg.org/ffmpeg-filters.html)

## 剪映

使用项目 `.local/jianying-venv`，从已审查的0.3.1创建路径生成唯一新目录；`scripts/jianying-requirements.lock`锁定本次Windows x64/Python3.12 wheel Hash，不改全局Python。安装示例：

```powershell
<已安装的Python3.12> -m venv .local/jianying-venv
.local/jianying-venv/Scripts/python.exe -m pip install --only-binary=:all: --require-hashes -r scripts/jianying-requirements.lock
```

草稿包含素材副本、裁切、独立轨、音量、淡入淡出、字幕及叠层透明度关键帧。修正库模板固定草稿ID和空名称，仅填入新目录已有元数据字段，旧目录绝不覆盖。源素材缺失或Hash变化则不标创建成功。

本机剪映11.8.0.14778与库自述的自动导出支持范围不同。**已创建JSON/检查素材引用，不等于已在剪映打开或导出**；当前打开为`not_verified`，自动导出关闭。随包CLI未有经过验证的写入契约，不执行其patch。保留草稿定位、手工在剪映打开/导出和FFmpeg路径。[上游说明](https://github.com/GuanYixuan/pyJianYingDraft)

## 可复现验收

`node --test tests/voice-edit-v12.test.mjs`覆盖原生请求契约、逐句费用依据与批准绑定、无生成门槛、去重、未知结果、真实纯音频解码、版本/迟到绑定、输入变化、独立声音资源版本、实际FFmpeg裁切/混音/字幕/fade/静音派生、原片保留及剪映草稿。云端响应均为隔离runner，不是账号连接或真实生成证据。

`node tests/production-v12-browser.mjs`在上述独立TEST项目副本上验证Chrome真实音频和视频解码播放、现有计划编辑保存、刷新、声音修改向剪辑传递复核、重启恢复及独立BGM上传/检查/选用。实际1.5秒字幕画面单独截图；浏览器控件遮罩与字幕画面分开检查。不会把测试时的源声明确认作为生成消费授权。

`node scripts/verify-production-v12.mjs`创建新的独立TEST项目，实际导出6.5秒技术测试MP4和无音轨派生，并创建独立剪映草稿。脱敏实测见 `studio-v12-evidence/production-local.json`。工作台与浏览器验收记录另列。尚缺剪映11.8实际打开/渲染验证、各账号资格和获批的真实TTS生成；不会因此触发生成来补证明。
