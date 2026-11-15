# 本地时间轴与MP4导出 0.7.0

从单镜视频页进入“本地时间轴”，或打开 `/timeline.html?projectId=<项目ID>`。只接受当前有效、人工检查通过且已选用的视频候选。测试素材持续显示 TEST FIXTURE / NOT AI，正式guard与账本仍为not_checked。

添加镜头后可上移、下移、移除并保存。每次保存产生不可变版本，绑定镜头/视频/图片/分镜及审核、选择、来源和实际文件Hash；使用源片完整实测时长，不改写源片时长。旧时间轴和导出记录保留。上游或选用变化后旧时间轴显示需复核，执行前重读最新状态。

点击准备导出只保存本地任务；点击执行才调用本机FFmpeg，不访问生成服务。先落执行意图，同一任务只执行一次。失败、取消、超时和重启保留错误及工作副本，不自动重导；需显式创建重导出任务。下载失败只重新下载已有输出。原始素材从不覆盖，旧导出仍可追溯，过期提示不将旧片冒充当前版本。

基础功能只做完整镜头无损顺序拼接，支持实测兼容的H.264 MP4。尺寸、编码、帧率、时间基、色彩和保留音轨参数不兼容时明确阻断，不自动拉伸、缩放或转码。暂不支持裁剪、变速、转场、字幕或配音。

音轨选择“保留源音轨”或“后处理静音派生”。静音导出使用`-an`且实测音轨为0；原片保留，不宣称模型原生无声。输出必须有FFmpeg成功回执和实际可探测MP4，FFprobe核验时长、尺寸、轨道及Hash后才标本地导出完成，仍需人工成片检查。

持久化目录为`data/timeline-workspaces/`、`data/timeline-versions/`、`data/timeline-exports/`及`data/runtime/timeline-exports/`。每次独立导出目录保存工作副本、ffconcat清单、命令、回执、实测结果和manifest。无需复制认证或重建数据目录。

接口：GET/PUT `/api/projects/:id/timeline`；POST其`/versions`和`/exports`；GET `/api/timeline-exports/:id`；POST其`/run`和`/cancel`；GET其`/file`（支持Range/HEAD）和`/manifest`。接口仅支持资产ID，不接受任意文件路径作为视频输入。

验收复用仓库中已存在的[测试MP4](video-v07-evidence/TEST-FIXTURE-NOT-AI.mp4)，5秒、1280×720、H.264、无音轨，SHA256 `7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3`。本地拼接出的测试文件不是新AI视频或真实即梦成片。测试和浏览器结果见[本轮验收](video-prep-v08-acceptance.md)。
