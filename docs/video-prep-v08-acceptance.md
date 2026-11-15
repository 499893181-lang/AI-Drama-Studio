# 视频真实接入准备与本地时间轴验收 v08

2026-11-16，Asia/Shanghai。软件0.7.0，独立分支`codex/canvas-video-prep-timeline-v08-20261116`，基于`codex/jimeng-video-workbench-v07-20261115`并确认包含`96b95e5418606586820ea4f9cec0f5603d153df3`。没有合并PR、清理旧worktree或迁移认证。原数据目录沿用，原507个文件逐字节Hash不变，原失败图像任务/result/error和1/1预算保持，自动出图继续关闭，未扩展hook。

## 真实渠道事实

复用已登录`dreamina-canvas 1.2.0`，读取实际help、Schema、模型目录及只读账户/空间。创建前检查同名目录；只创建独立测试画布、上传现有TEST PNG、导入来源图片节点、保存并编辑同一个待生成视频空草稿、回读并报价。没有切换当前生产画布，没有同步生产画布。消费确认0、生成提交0、视频产物0；未调用配音。创建待生成节点与导入已有视频节点在代码和说明中明确分开。

真实绑定与最新费用见[渠道核查](canvas-video-channel-v08.md)和[官方回执脱敏快照](canvas-video-v08-evidence/check.json)：`node_ht5aaps7yz`，draftVersion3，`seedance_2.0_vip`，5秒720p、16:9、count1，真实`node quote`最大预估70积分。没有quoteId、有效期、人民币价格或实际扣费；未知保持null。100积分不是报价或已授权硬限额。适配器`submit/confirm`和运行命令在进子进程前硬关闭，不会因为报价存在而自动提交。只读[工作台证据页](http://127.0.0.1:4320/video-channel.html)不会调用CLI。

canvas同节点报价不能挪用给direct。本轮再次只读查询direct的`user_credit`，退出码1、认证不可用且缺同渠道报价，记录[当前独立认证状态](video-prep-v08-evidence/direct-status.json)；因已有可报价canvas路径，本轮没有多发一次direct授权。账号运行准入、真实终态及视频下载仍待受控验收。尤其`resource download`帮助通用，但Schema摘要仅写图片素材，没有已验证视频支持；本轮只下载了上传的PNG，不以此宣称视频下载接通。[选出的实际Schema字段](video-prep-v08-evidence/cli-schema-excerpts.json)和[实际下载帮助](video-prep-v08-evidence/resource-download-help.txt)保留此差异。

本地原PNG与平台注册资源下载PNG的字节Hash不同，分别记录。Chrome均实际解码为1280×720，RGBA Hash一致；这只证明本次解码像素一致，原因未返回不作推断，也没有模型实际参考使用回执。下一次画面仍需视觉检查。

## 测试和浏览器

基线252/252通过；本轮新增27项，最终完整回归**279/279通过，0失败、0跳过**。包括草稿/导入边界、生成与确认硬关闭、错绑定/模型参数/草稿版本/空节点/未知报价、脱敏和审计旧回执保留，以及时间轴Hash/当前审核/来源失效、任意路径拒绝、并发去重、取消/超时/无效输出、重启、旧片保留、实际FFmpeg输出和HTTP Range/HEAD。

真实Chrome结果分别保存，均为隔离TEST或只读实际准备验收，未调用真实生成：

| 范围 | 检查组 | 结果 |
| --- | ---: | --- |
| 新本地时间轴 | 12 | 三镜头排序保存、15秒实际拼接及播放、manifest、失败重导、取消、失效、重启、390px布局通过 |
| 既有视频工作台 | 7 | 原任务查询/下载恢复及候选/人工选用回归通过；外部回执为隔离夹具 |
| 文字与分镜 | 7 | 原规则、版本、独立报告、采用保护回归通过；模型为隔离夹具 |
| 手工图片 | 7 | 上传/预览/三镜头绑定/换版/失效/重启通过；明确TEST图片 |
| 剧本 | 8 | 保存、版本、独立报告、过期与重启通过；模型为隔离夹具 |
| 实际主服务 | 4 | 真实报价存档页、PNG两层解码、原数据目录测试时间轴播放、原507文件及图像1/1不变 |

[机器总记录](video-prep-v08-evidence/check.json) · [时间轴Chrome详细记录](video-prep-v08-evidence/timeline-browser.json) · [主服务画面](video-prep-v08-evidence/actual-main-timeline-test-only.png) · [窄屏](video-prep-v08-evidence/timeline-mobile-fixture.png) · [导出播放](video-prep-v08-evidence/timeline-export-playback-fixture.png) · [过期重启恢复](video-prep-v08-evidence/timeline-restored-stale-fixture.png)。

本地验收复用已存在5秒TEST MP4三份引用，按SHOT-03→SHOT-01→SHOT-02拼接。FFprobe实测输出15秒、1280×720、H.264、0音轨，Chrome实际播放，输出SHA256 `b4a26f91381ae647736daf9e5ccb367babb73f9b7601fea27b03bed86668d4f9`。源文件SHA256 `7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3`不变。测试源本来没有音轨；本轮新时间轴`-an`路径不能当作有声转无声实际素材验收。既有媒体模块的有声测试属于原回归，与新的无声TEST源验收分开。

## 可用入口和数据

- [主服务时间轴TEST项目](http://127.0.0.1:4320/timeline.html?projectId=437306c6-d0b8-4b1b-86b4-6c259c89b006)：复用原DATA_DIR，独立测试项目，3段15秒，不是即梦成片。
- [只读实际报价存档](http://127.0.0.1:4320/video-channel.html)：空视频节点、同节点价格、来源与未授权状态。
- [原视频准备项目](http://127.0.0.1:4320/video.html?projectId=76e18591-47fc-48cf-992d-112d183a3036)：原direct prepared任务未提交，未追改成canvas任务。
- [官方独立测试画布](https://jimeng.jianying.com/ai-tool/ai-canvas/7f2bee13-2e6f-4097-9281-b814c3a314a2)：只保存草稿，当前没有视频产物。

新数据仅追加独立TEST项目及时间轴/版本/导出/manifest，旧人工稿、图片、任务、认证与原失败回执全部保留。审计脚本每次运行写唯一不可变目录，旧顶层回执先归档，最新文件仅作指针，非JSON启动/超时诊断也脱敏保留。公开仅导出非个人验收记录，data、认证、signed URL、token和私有原始材料不进Git。

## 后续范围

[可直接审核的下一次单镜方案](video-real-acceptance-plan-v08.md)：同一实际首帧、同节点、同模型/5秒720p，最多一笔外部视频任务；最新最大预估仍不超过70积分并获本人明确确认后，才可实施下一阶段受控提交与候选回传。无原生音频开关时保留原片，再本地去音轨派生并FFprobe核实；不是模型原生无声。

当前未完成：画布真实生成与下载端到端连接、模型实际运行资格、实际参考使用/画面验收、最终费用；direct认证和同渠道价格；正式四岗位guard/账本集成。时间轴只提供完整兼容MP4顺序拼接，无裁剪、变速、转场、字幕或配音。正式验证始终not_checked，不把本地导出成功或测试报告冒充正式作品PASS。
