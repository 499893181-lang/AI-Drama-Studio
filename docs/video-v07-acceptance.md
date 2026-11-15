# 视频工作台0.6.0：无生成积分验收

基线`codex/image-contract-fix-v061-20261115`包含`c488d1cf78d450777d13e243bc1678483d465902`；独立实施分支`codex/jimeng-video-workbench-v07-20261115`。本轮真实视频提交0、AI生图0、模型turn0、画布写入0、配音及生产剪辑任务0。没有购买积分或切换付费API。

## 已交付与测试

实现当前有效且人工检查选用的分镜图绑定、参数/独立视频报价与预算、持久化任务、提交去重、原外部ID查询与下载恢复、实际文件FFprobe核验及Range预览、候选/检查/选用分离、单镜重做和版本过期。原手工图片流程保留，自动出图继续关闭，未改其hook机制。

`node --test tests/*.test.mjs`：**252/252通过，0失败、0跳过**。基线215项；新增CLI适配10、视频任务/存储22、真实FFprobe媒体3、HTTP/Range与费用2项。测试均为隔离adapter与明确标注的本地素材，未调用真实生成。

真实Chrome共33项检查通过，0未处理页面异常：

| 页面 | 检查数 | 范围 |
| --- | ---: | --- |
| 视频隔离流程 | 7 | 准备、未知费用禁用、并发去重、query失败原ID、download失败只重试、播放、人工选用、重做、拒绝图后过期及重启 |
| 原图片工作台 | 7 | 上传/换图、旧图历史、缓存JSON/ZIP失效、重启 |
| 原创作工作台 | 7 | 文字候选/规则/人工版本/过期与恢复，全部隔离runner |
| 原剧本工作台 | 8 | 未知费用、输入、版本、报告与重启，全部隔离runner |
| 实际待提交任务 | 4 | 绑定真实本地测试PNG、未知费用禁用、两个CLI登录分开、原data和1/1保持 |

视频隔离runner调用submit2/query3/download3：第二次submit是用户显式单镜重做，不是重复点击或故障重提。测试MP4为FFmpeg确定性生成，画面写有TEST FIXTURE / NOT AI，1280×720、5秒、H264、音轨0、17,750字节，SHA256 `7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3`。生产FFprobe与Chrome实际加载/播放均通过；这不证明即梦真实生成成功。

首次视频测试驱动被Chrome无手势播放策略拒绝，保留原日志；改为静音播放器预览后通过，没有去掉或修改测试视频音轨。实际待提交页面首次断言使用了“待登录”而页面实际为“需要登录配置”，更正测试文案后通过，产品登录状态并未改变。

## 本机工具与能力

- dreamina 1.4.22，direct CLI当前未登录；未发起login/relogin/logout。
- dreamina-canvas 1.2.0，当前已登录；只读复用核查，未上传或写入画布。
- 本机FFmpeg/FFprobe 9.0.2，已实际探测并用于明确测试文件。
- image2video实际模型、时长、分辨率及查询/下载帮助已读。默认seedance2.0_vip/5秒，准备方案使用720p；图片格式/像素边界帮助未列，仍待核实。
- 无原生音频关闭flag；无direct视频quote命令，模型额度和账户余额不能代替价格。canvas node quote要求已有节点且渠道不同，未套用到direct视频。
- canvas resource upload + video node导入契约已检测但未真实验收，状态not_synced；没有用文字节点冒充媒体。
- 真实CLI任务回执、下载及模型准入尚未经过实际视频任务验收，隔离回归不能当作真实接口成功。[实际帮助核查](jimeng-video-cli-v07.md)

## 已保存的实际准备与原记录

本机服务0.6.0继续使用原DATA_DIR，保留原500份数据文件Hash（重启PID锁studio.lock除外）；原图像失败任务、备份、回执、原图、诊断和原1/1均未改变。原4317/4318/4319服务及原工作树未提交内容保持；仅新增独立非个人验收项目及其测试图片、版本和prepared视频任务。

实际本地项目`76e18591-47fc-48cf-992d-112d183a3036`已保存1280×720测试卡图片，人工软件检查后选用；任务`00e1653b-f54a-461e-8a6c-09430b7c8e15`为prepared，submittedAt/externalTaskId均null，没有消费意图或真实视频候选。100积分只是待确认方案建议上限，不是报价或授权。页面：`http://127.0.0.1:4320/video.html?projectId=76e18591-47fc-48cf-992d-112d183a3036`。

真实视频的下一步缺口是direct登录、同账号/模型/参数/渠道的可核实费用及上限、实际输入平台限制与模型资格、用户明确批准。原生提交在适配器和服务层保持关闭，不因预算输入、环境变量或新目录开放。完整[单镜真实验收方案](video-real-acceptance-plan-v07.md)列明实际素材、模型、5秒、费用缺口及建议100积分上限；本轮不执行。

正式guard与账本仍not_checked/未接入；软件测试通过不等于正式作品PASS。实际扣费保持未知，不根据报价预留或余额伪造消费。

## 可分享证据

[机器记录](video-v07-evidence/check.json) · [实际输入图片](video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png) · [实际待费用确认页面](video-v07-evidence/prepared-unknown-fee.png) · [隔离候选播放/选用](video-v07-evidence/fixture-candidate-selected.png) · [隔离过期恢复](video-v07-evidence/fixture-restored-stale.png) · [明确非AI测试MP4](video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4)。

公开记录不含个人data、认证、签名下载URL或原始账户材料。唯一小MP4是17KB确定性测试夹具的显式例外，不是生产生成素材。完整私有测试与CLI帮助留在`tests/.artifacts/`，Git忽略。

复核命令：`node --test tests/*.test.mjs`、`node tests/video-browser-smoke.mjs`；原图片/创作/剧本browser smoke分别按既有文档执行，均不启动真实模型。`scripts/prepare-video-acceptance.mjs --prepare-only`只建独立验收输入与准备任务，没有真实提交选项；`scripts/verify-video-preparation.mjs`只读检查；`scripts/export-video-evidence.mjs`白名单导出。
