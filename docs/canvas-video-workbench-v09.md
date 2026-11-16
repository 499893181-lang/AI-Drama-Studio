# 待授权画布执行工作台0.8.0

页面为`/canvas-video.html?projectId=<本地项目ID>`。准备读取真实当前节点和最新同节点报价，并绑定当前人工检查选用的图片、项目/镜头/分镜/知识Hash、图片审核与选择版本、平台首帧资源、草稿版本、模型参数和账号上下文。旧任务及原范围不重绑；草稿变化后另备任务，原记录仍可查。

本轮没有本人批准和消费确认；生产页面只展示待授权状态。HTTP请求没有发放授权的接口，JSON里的confirm/authorized/grant等自报字段不能批准消费。旧纯准备适配器和自动出图仍关闭；新执行适配器只有本机签名的具体任务批准通过后才能运行，不靠环境变量开关。

## 本机批准与执行

本机工具只读查看当前scope和报价：

```powershell
# DATA_DIR必须指向原数据目录。
node scripts/canvas-video-approval.mjs --task <已有任务ID>
```

只有本人明确批准当前具体范围后，才允许操作者另外执行`--record-user-approval <本人声明>`，同时提供准确`--scope-hash <当前Hash>`、`--max-estimate 70`及`--task <原任务ID>`。本轮没有执行此录入。签名材料与批准记录保存在原DATA_DIR的`canvas-video-approvals/`，不复制平台认证、不进Git，也不经HTTP暴露签名或Key。签名说明本机操作者的批准记录，不冒称平台身份签名。

默认批准本地有效期1小时，最多允许一次；过期或scope改变失效，不自动重签。损坏批准或签名历史阻断，不忽略历史重新发放。70是最大预估批准阈值，不是最终结算或平台绝对扣费保证。本机批准录入也不等于已经调用消费确认；提交时再次回读报价。

已获合法本机批准时，用户或获授权操作者才可执行此任务。服务在外部副作用前保存submitId和唯一意图，认领一次批准；确认token仅保留内存，确认/运行回执和错误均剔除凭证。每个网络回读之后再核对当前本地版本。完整范围和批准在各敏感边界复查，既不以旧PASS授权，也不要求先付费证明模型资格。

## 恢复、原片和候选

结果未知时只查询原submitId，查询失败继续原任务。成功必须有匹配操作终态和唯一成功视频资源，`resource get`再查同ID/类型/状态。下载失败只恢复同资源到新目录；实际文件、回执Hash/字节数、FFprobe都通过后才导入候选，不能凭路径或成功文字。

原片长期保留于任务受控目录，原片Hash与probe及平台/节点/资源/submit来源写入资产provenance；可单独下载原片。发现音轨时本地生成无音轨派生、记录父子Hash并实测，原片不覆盖。候选、人工检查和选用分别持久化；迟到结果沿旧绑定，新要求使候选需复核。旧资产与人工选择历史保留。

`CanvasVideoService`储存`canvas-video-jobs/`任务、`runtime/canvas-video/`逐次不可变脱敏回执和独立下载目录。重启/超时/取消不自动重新确认或生成，迟到回执留证但不复活状态。同一节点存在提交意图后，不能靠另备任务重复生成。

接口：GET/POST `/api/projects/:id/canvas-video`；GET `/api/canvas-video-tasks/:id`；POST其`/refresh`、`/submit`、`/query`、`/download`、`/cancel`；GET/HEAD其`/original`支持Range。检查/选用复用`/api/projects/:id/videos/review|select`，视频候选文件沿用原资产接口。

## 真实边界

下载TEST资源已经实际验证，见[下载预检](canvas-video-download-v09.md)。完整付费链路只做隔离测试，真实生成0、消费确认0；注入runner和resolver始终标TEST，不能自报为官方成功。正式四岗位guard及账本保持not_checked。

官方CLI无按期望草稿版本原子执行参数，应用多次回读与当前存储校验不能消除外部最后瞬间编辑的窗口；实际generationDiff缺省就记录未返回，不补造。模型实际运行资格、真实终态与首帧符合性留获批任务验证。[首次单镜方案](video-first-run-plan-v09.md) · [本轮验收](canvas-video-v09-acceptance.md)。
