# 即梦画布视频准备与报价核查 v0.8

核查于2026-11-16（Asia/Shanghai），基线`96b95e5418606586820ea4f9cec0f5603d153df3`。已复用本机`dreamina-canvas 1.2.0`的现有登录。本轮实际外部操作仅有独立测试画布创建、已有测试PNG上传/导入、待生成视频草稿保存及一次文案编辑、只读回读/报价、已上传PNG下载校验。**生成提交0、消费确认0、视频产物0**。没有切换当前生产画布、没有同步生产画布、没有改变原自动出图1/1记录。

## 实际能力与边界

| 环节 | 实际帮助与Schema | 本轮证据范围 |
| --- | --- | --- |
| 认证与空间 | `auth status/account`、`space current` | 登录和只读账户访问成功；个人空间、无团队；不保存个人身份或余额 |
| 模型 | `model list --type video` | 返回12个视频模型；使用canonical `seedance_2.0_vip`，单图片首帧、5秒、720p、16:9、1个候选符合目录；目录不等于账号运行资格 |
| 创建待生成节点 | `node create video`明确“创建视频节点，不触发生成”；`run=false`约束明确“only save the draft” | 真实保存成功，`status=empty`、`resources=[]` |
| 编辑同一草稿 | `node edit video`明确“编辑视频节点，不触发生成”；不加`--run`仅保存 | 同节点按完整generation替换文案，稳定新updateId，旧文案/回执保留；draftVersion由2到3 |
| 既有视频导入 | `node create video --resource-id ... --import-kind ...` | 用来挂已成功登记的视频产物；不等于创建待生成草稿。本轮没有导入视频 |
| 权威报价 | `node quote --project-id ... --node-id ...`，`reads=true/writes=false` | 同画布、同视频节点、同草稿版本的真实报价已取得，未确认消费 |
| 批准与提交 | `node confirm`签发短期凭证；`node run`触发运行、逐节点submitId | 仅读取Schema/帮助；适配器和审计脚本在子进程前硬拒绝，未调用 |
| 查询 | `operation status/wait <submitId> --project-id ...`，`reads=true/writes=false` | 契约已读取；本轮没有视频提交身份，不虚构查询结果 |
| 下载 | `resource download <resourceId> --project-id ... --output ...` | 仅成功下载已上传PNG。help通用，但Schema摘要仍写“图片素材”，没有明确的视频类型保证；视频下载/播放/FFprobe仍需下一笔获批真实验收 |
| 音频 | 实际视频help/Schema和模型flags没有原生音频开关 | 方案为保留原片后本地`-an`派生，并FFprobe复核无音轨；提示词没有配音不等于原生静音 |

目录中的模型会员提示、账号会员快照、草稿保存成功和`confirmable=true`都不升级成“生成准入已验证”。不能将画布登录当作direct登录。当前可为画布同节点取得可审核费用，故本轮没有为direct渠道另外启动授权；direct的认证/价格缺口保持原状。

## 独立测试绑定

[测试画布](https://jimeng.jianying.com/ai-tool/ai-canvas/7f2bee13-2e6f-4097-9281-b814c3a314a2)，名称`AI-Drama-Studio_v08_单镜5s验收`。创建前分页目录`hasMore=false`且无同名；创建未带`--use`，返回`current=false`。

- projectId：`7f2bee13-2e6f-4097-9281-b814c3a314a2`
- 上传Resource：`3e74fdf2-d290-4979-a200-4968dea502be`
- 来源图片节点：`node_agvq74dwqs`，`source=uploaded`，成功且仅有一份上述资源。
- 待生成视频节点：`node_ht5aaps7yz`，`status=empty`，`resources=[]`，上游连线和`generation.references`都指向来源图片节点。
- 正式计划模型：`seedance_2.0_vip`；`mutation.effectiveGeneration`另返回`seedance2.0_vip`，按真实字段分别保留，不拿direct命名替换canonical写入名称。
- mode=`first_last_frame`、duration=5秒、resolution=`720p`、ratio=`16:9`、outputCount=1。

最新保存的实际提示词：

> 保持首帧测试卡的文字和布局；固定机位，5秒内仅蓝色色块做轻微明暗变化。不新增人物、真实场景或额外字幕。本次是软件链路验收。

输入为仓库已有`docs/video-v07-evidence/TEST-FIXTURE-NOT-AI-input.png`，1280×720；这是明确标注的测试卡，不能当作真实AI出图证据。

## 费用事实

脱敏机器记录见[check.json](canvas-video-v08-evidence/check.json)，以其中最新`checkedAt`、`requestId`、`draftVersion`为准。真实节点报价返回：

```json
{
  "items": [{"nodeId": "node_ht5aaps7yz", "maxCredits": 70}],
  "totalMaxCredits": 70,
  "draftVersion": 3,
  "confirmable": true,
  "confirmationRequired": true
}
```

70的口径是**当前个人消费主体、此画布节点及已保存草稿的运行前最大积分预估**。不是已扣费、最终净花费、人民币价格、平台硬限额或direct image2video的报价。未返回official quoteId、报价有效期、人民币金额、兑换率和结算账本；字段保留null。100积分仍只是未授权的计划预算，尚未执行`confirm`。运行前必须重新核对当前输入/节点/模型/参数并重新报价，取得用户明确批准后方可制定批准上限；本轮不能打开生成入口。

## 三层参考证据

1. 本地原PNG在上传前核对SHA256：`0a016af311df50b5b82ead4dc39292d03e8ed5eef738eac3197336de3c6b53ba`。上传回执只给resourceId/mediaType，没有平台文件Hash。
2. 实际注册资源通过官方`resource download`下载，4618字节、SHA256 `679b92bc271603e46dd9eb2650d678129cf0d9bd279375159e1b2da012697e16`，CLI回执与本地再次Hash一致。与原文件字节不同；原因没有由服务端返回。主验收在真实Chrome中分别解码原PNG与注册PNG，均为1280×720，RGBA像素Hash均为`4e3111e6fe61d7e035f753969848aed5fa25faf4971f03ce66535b1ecfe613b8`。这仅证明此次浏览器解码后的像素相同，不替代文件Hash、不证明生成工具使用。
3. 草稿回读只证明图片资源绑定和视频引用连线。**没有生成提交，没有图像/视频模型实际使用参考的回执**；未来画面是否符合首帧仍须视觉检查。即使浏览器RGBA一致，也只能说明此次解码像素一致。

## 适配器与恢复

`src/canvas-video.mjs`提供动态模型参数校验、严格纯准备argv白名单、回读核对、同版本报价解析、脱敏和本地只读DTO。`readCanvasVideoEvidence()`不调用CLI，存档永不作为当前授权。`submit()`和`confirm()`在任何解析/文件/子进程工作前抛409；不接受配置或环境变量开启。白名单同时拦截`--run`、`--yes`、积分token/ceiling以及会改当前画布的`--use`。

报价前重读两节点，要求来源图片成功、恰有绑定的唯一资源；视频必须明确empty、资源数组明确为空；完整mode/prompt/model/ratio/resolution/duration/count、引用身份、可写回标记与upstream连线匹配。报价只接受一个匹配node、无逐项error、非负整数金额、item与total一致、同draftVersion与planHash。未知、错误、截断、超时、错版本、已运行或选片歧义保持未知/阻断。没有把已有资源或失败任务追改为成功。

`scripts/audit-canvas-video-v08.mjs`默认只读inspect；`--prepare`仅对独立测试画布保存，写前持久化稳定project/resource/node/update/import-submit身份；重试不换ID；同名冲突、上下文不明和回读不符停下。`--refresh-quote --write-evidence`只读核对既有节点并导出脱敏快照。脚本没有生成模式。

每次审计建立独立`tests/.artifacts/canvas-v08/runs/<时间-UUID>/`，用`wx`独占创建逐条脱敏回执；同名分页/并发检测也分序号，不覆盖。写汇总前将既有顶层JSON逐字节复制到本轮`previous-top-level-json/`，保留旧收据和稳定state；顶层`latest.json`、`inspection.json`、`check.json`仅为最新归档的汇总指针。即使CLI启动失败、超时或返回非JSON，仍追加脱敏stdout/stderr、退出码和timeout事实，不把无响应造为官方回执。本轮在该修复后未再运行CLI，归档行为用独立临时目录测试。

一旦下一阶段获准运行，必须先落盘逐节点submitId再提交一次；查询使用原submitId，任何不确定结果不重提；下载只重试同Resource。报价/批准/submitId是三个不同事实，短期授权材料不入库。视频候选的成功仍必须同时具备官方终态、实际可下载文件、Hash、FFprobe与浏览器播放证据。

## 测试与未完成项

新增隔离测试覆盖纯准备白名单、生成/消费硬关闭、动态参数、导入与生成草稿区别、当前来源/选片/引用与版本核对、empty/无资源门槛、错绑/缺字段/部分报价/团队/超时、脱敏、存档不可授权。所有测试使用明确夹具；不证明真实视频成功。完整回归与浏览器验收由本轮总记录给出。

下一次最多一笔5秒720p文字提示+首帧视频真实验收仍需用户批准，且只走此同节点画布报价渠道。实际运行资格、视频资源下载支持、模型参考使用和音轨、最终扣费均未验证；发现缺口保存原身份/回执/产物，不切换付费API或direct、不新增任务补证据。
