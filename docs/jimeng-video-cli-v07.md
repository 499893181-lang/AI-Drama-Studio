# 即梦单镜头视频CLI契约核查

核查日期2026-11-15，基线`c488d1cf78d450777d13e243bc1678483d465902`。本轮只运行实际版本、帮助、只读账户与模型/Schema命令，**没有上传素材、写画布、提交图像/视频/配音任务或启动剪辑**。帮助发现、隔离测试与真实生成分别记录。

## 本机实际状态

| 项目 | 实际结果 |
| --- | --- |
| dreamina | 1.4.22，commit `db0e56a8c2dc2c4cbb240f7f789cb834a62ffff5` |
| direct CLI登录 | `dreamina user_credit`返回“未检测到有效登录态”，未发起login/relogin/logout |
| dreamina-canvas | 1.2.0，`auth status`明确`loggedIn=true`，只读复用现有登录 |
| 身份范围 | 两个CLI登录分别核对，canvas已登录不能当作direct CLI已登录 |
| 当前生产视频提交 | 适配器硬关闭；不能通过环境变量、目录或伪造参数开放 |

完整原始帮助及脱敏检测快照留在Git忽略的`tests/.artifacts/video-cli/`。不提交认证文件、账户身份、签名下载URL或授权材料。

## 图生视频的实际命令

已读取`dreamina -h`、`image2video -h`、`query_result -h`、`list_task -h`及`user_credit -h`。

```text
dreamina image2video --image <本地首帧绝对路径> --prompt <运镜提示词> --model_version seedance2.0_vip --duration 5 --video_resolution 720p --poll 0
dreamina query_result --submit_id <原任务ID>
dreamina query_result --submit_id <原任务ID> --download_dir <本次独立下载目录>
```

上面是已核对的调用计划，本轮没有执行第一条。`--image`、`--prompt`、`--video_resolution`必填；默认模型`seedance2.0_vip`，默认时长5秒，默认session为0。没有显式比例时从首帧推断，不自动方屏。

| 模型 | 时长范围 | 分辨率 |
| --- | --- | --- |
| seedance1.0fast | 5–10秒 | 720p |
| seedance1.5pro | 5–12秒 | 720p |
| seedance2.0 / seedance2.0fast | 4–15秒 | 720p |
| seedance2.0_vip | 4–15秒 | 720p、1080p、4k |
| seedance2.0fast_vip / seedance2.0mini | 4–15秒 | 720p |
| seedance2.5 | 4–30秒 | 480p、720p、1080p；帮助标为VIP-only |

支持比例是1:1、3:4、16:9、4:3、9:16、21:9。Seedance2.0系列允许独立设置，legacy模型需匹配首帧；seedance2.5必须省略`--ratio`，显式传入会被拒绝。模型名只是CLI公开集合，实际账号权益、模型可用性和首次使用确认仍以服务端准入为准。

帮助没有列输入图片格式、文件大小或像素上下限，适配器明确保存null/待核实；本地PNG/JPEG/WebP解码成功不能冒称即梦平台准入成功。测试图片尺寸不作为官方输入限制证据。

## 音频控制

实际image2video帮助没有音频开关、关闭音轨或静音参数。适配器不会猜`--audio`、`--mute`之类参数，也不会靠提示词宣称原生无声。界面使用：

- `provider_default`：保留提供方实际输出，音轨以下载后的FFprobe为准。
- `mute_derivative`：显式记录另作本地去音轨派生的计划，保留原片；不宣称模型原生关闭音频。是否实际派生及其验收须另有记录，本轮不处理用户真实片段。

## 费用与预算

顶层帮助明确所有生成消耗积分，但direct CLI没有公开quote命令，也没有本账号/模型/时长/分辨率的可确认单笔费率或总价。因此适配器报价始终为`unknown`、`amount=null`、单位CREDITS，不能显示免费。积分余额、文字剧本报价、人民币预算或积分兑换率都不能代替视频报价，不造官方quoteId或价格。

canvas确有`node quote`，实际帮助要求已保存的`node-id`及项目。Schema顶层没有无需节点的direct video/quote入口；实时12个视频模型规格未返回price/credit/quote字段。它是独立画布渠道，不能套用于direct `image2video`。本轮不为取得报价而创建节点或上传素材。

后续提议的积分预算上限仅是方案字段；取得真实报价且用户确认前不消耗积分。当前还缺direct CLI有效登录、本渠道权威价格与计价条件、模型权益以及真实输出契约验收。

## 查询、下载及不确定状态

公开流程用`submit_id`查询原任务；`gen_status=querying`为受理/等待，`success`为提供方终态，`fail`保留原因。适配器保守要求回执匹配原`submit_id`并返回可识别状态；非零退出、非JSON、ID缺失/错绑或未知状态都保存原始回执并显示未知，不能冒充成功。本轮尚未用真实生成任务验证实际JSON外形；解析器隔离测试不等于官方实测成功。

query_result的`--download_dir`使用官方下载场景。适配器每次重试都新建一个本地下载尝试目录，保留旧文件，拒绝使用`video_url`预览链接冒充下载文件。只有对应终态和实际目录中的视频文件可交给后续FFprobe；文字成功、任意文件名、0个或多个文件都不能直接成为视频候选。媒体Hash、格式、时长、尺寸、音轨及预览由工作台另行核验。

direct image2video帮助没有客户端request-id/submit-id参数，不能宣称服务端严格幂等。工作台先保存本地提交意图，以防重复点击；如果外部ID丢失或网络结果不确定，必须保留unknown并人工核对，不自动重提。已有ID时查询失败继续查询原ID，下载失败只重试原任务的下载，取消/超时/重启不发新生成。

## 画布同步能力单独记录

实际Schema/帮助暴露以下媒体导入路径：

```text
dreamina-canvas resource upload --project-id <项目UUID> --file <本地视频> --type video --import-kind <登记意图> --resource-id <稳定资源UUID>
dreamina-canvas node create video --project-id <项目UUID> --resource-id <已登记资源UUID> --import-kind <登记意图> --submit-id <稳定UUID>
```

`resource upload`支持本地图片/视频/音频；节点绑定的资源须已登记、成功且为视频。`import-kind`公开值为`local_upload`或`external_generated`，最终应按素材真实来源及实际返回契约选择。稳定Resource/submit身份用于恢复，不能新建副本掩盖不确定状态。

本轮只核查命令与Schema，未上传、创建节点或验证媒体可在画布播放；状态为`detected_not_verified`。direct视频完成、画布文字节点存在或手工保存正文，都不能报告为媒体已同步画布。

## 适配与隔离验证

`src/dreamina-video.mjs`提供inspect、quote、submit、query、download和纯命令计划/参数校验。真实submit的完整调用代码位于不可配置false门禁之后：重新核实契约和direct登录、实际图片及参数，真正启动CLI前要求服务端可信闭包beforeSubmit同步重读当前存储（缺失或异步复核均拒绝），使用已读帮助的image2video argv，解析实际submit_id/gen_status及原始回执；没有发明幂等flag，缺ID或状态不确定不会重试。门禁在CLI解析、文件访问、最终复核闭包和子进程之前拒绝，本轮没有执行该生产分支。inspect有60秒缓存和并发合并，避免页面轮询反复查询CLI；显式刷新仍只读。原始回执中的授权字段及带query的签名URL在保存前脱敏。

`tests/dreamina-video.test.mjs`共10项，全部通过：登录范围、公开参数、音频边界、未知报价、真实提交在CLI解析和文件访问前硬关闭、首次提交回执合法/缺ID/未知状态与传输失败、错绑/缺失/错误终态、原ID查询、下载恢复及不下载预览链接、只读缓存。本地测试runner/伪MP4都是明确隔离夹具；该文件不是可播放即梦产物，后续媒体模块必须拒绝它。没有真实生成积分消耗。
