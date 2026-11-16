# 首次真实视频生成前的最后准备验收

2026-11-16，Asia/Shanghai。基线`codex/canvas-video-prep-timeline-v08-20261116`，确认包含`af4d70413e0064c43f2152796346252bce47008c`；独立分支`codex/canvas-video-execution-v09-20261116`，软件0.8.0，没有合并PR。全程真实`node confirm`和`node run`均为0，无新增AI图片、视频或配音。原数据目录复用，原530个文件Hash不变，认证不复制，原失败图像任务及1/1保持，自动出图继续关闭。

## 已实际验证的下载

在独立下载测试画布纯登记并导入原有TEST FIXTURE / NOT AI MP4，实际help/Schema核实上传及不带run的导入不触发生成。官方resource download已成功下载此视频。原片与下载片均17750字节、SHA256 `7de983635b4b445d23d72d09ca41f0c30d255a14a0e3df25647ad6e2116800b3`，无字节或媒体差异；FFprobe5秒1280×720、H.264、24fps、0音轨；Chrome两片实际播放。不能把登记/导入的TEST视频当作AI生成。

[下载预检说明](canvas-video-download-v09.md) · [官方脱敏回执](canvas-video-download-v09-evidence/receipts.json) · [实际Schema选段](canvas-video-download-v09-evidence/schema-excerpts.json) · [播放截图](canvas-video-download-v09-evidence/test-resource-download-playback.png)。实际支持范围为本机1.2.0及此次视频资源，不把摘要仍写图片的矛盾藏起，也不靠付费生成验证下载。

## 待授权执行链路

实现当前节点回读→最新同节点报价→本人本机签名批准校验→消费确认→单节点run→原submitId查询→原视频资源下载→原片保留/必要静音派生→候选。真实生产路径当前无批准，不执行消费；隔离runner始终标TEST。

完整scope绑定本地项目/任务/镜头图片和上游Hash、画布/节点/首帧资源、草稿版本、原输入和平台注册资源Hash、模型/提示词/参数及账号上下文Hash。HTTP自报授权不能签发或替换批准。单次认领和submitId/意图先落盘，损坏签名历史阻断；重复并发只执行一次，重启/取消/超时/未知不自动重提。确认短期凭证只在内存，原始回执只保留脱敏安全事实，错误回显同样移除。

最新最大预估须≤70才允许批准；70是预估批准阈值，不是已结算或平台绝对扣费上限。100积分仅旧未授权计划预算。原始报价无有效期、quoteId和最终结算，不补造。模型资格、真实终态、首帧符合性留首次获批任务，不要求提前付费证明。

查询必须匹配原operationRef、明确成功终态与唯一成功资源，再resource get核同ID/type=video/status=success。下载回执、实际文件Hash/字节数及FFprobe核验后才入候选；原片和静音派生分别保留来源与Hash。候选、人工检查、选用分开。新要求后旧结果保留原绑定并需复核。

CLI没有expectedDraftVersion原子提交参数；应用在每次网络回读后重验本地输入，并再次核对远端scope，但不能宣称锁住最后瞬间的外部编辑。保留真实返回的generationDiff；缺省就记未返回，不能推断无差异。[执行契约及限制](canvas-execution-v09.md)

## 测试结果

基线279项通过，新增38项；最终完整回归**317/317通过，0失败、0跳过**。覆盖授权签名/伪造/损坏历史、报价超70/未知/失败、草稿/账号/图片来源变化、最后一次网络期间人工稿改变、短期token和错误脱敏、并发去重、原ID查询、非视频/错资源/矛盾终态拒绝、下载失败恢复、实际文件Hash、原片及派生provenance、候选与人工选用分离、超时/取消/迟到/重启及旧版本保留。

真实Chrome新画布工作台9组、既有视频7组、本地时间轴12组通过；实际主服务3组只读检查通过。新画布浏览器使用可信temp签名及明确TEST素材，不是本人真实消费批准；其模拟提交/确认不算官方调用。实际主服务当前无签名批准，submit按钮禁用，实际首帧1280×720解码成功，原530文件/1/1核验通过。

[总机器记录](canvas-video-v09-evidence/check.json) · [9组Chrome详细记录](canvas-video-v09-evidence/browser.json) · [实际主服务待授权截图](canvas-video-v09-evidence/actual-pending-no-authorization.png) · [隔离候选实播](canvas-video-v09-evidence/canvas-test-candidate-playback.png) · [过期恢复](canvas-video-v09-evidence/canvas-test-restored-stale.png) · [390px布局](canvas-video-v09-evidence/canvas-test-mobile.png)。

本轮上传/下载的真实TEST视频本来没有音轨。新服务有声派生分支使用明确隔离音轨注入验证控制流和父子来源，不冒充本次真实有声视频验收；既有FFmpeg媒体模块的实际有声去轨回归也通过。未来真实视频如含音轨，按已批准无声交付范围本地派生并再次FFprobe，原片保留。

## 已保存待授权范围

任务`ecab5569-0001-449b-bbb0-0e07a6fff981`，稳定submitId`1378ddcd-37ad-4c71-8b0c-ce9e32c51944`；status=prepared、submittedAt=null、result=null、无批准。仍为原`node_ht5aaps7yz`空视频草稿3，5秒720p/count1。最新报价70，requestId`20261116103340D991110DFE569EFB43F4`。完整scope和Hash见[待授权原始方案](canvas-video-v09-evidence/pending-plan.json)。

[主服务入口](http://127.0.0.1:4320/canvas-video.html?projectId=76e18591-47fc-48cf-992d-112d183a3036) · [可明确批准的一次真实验收方案](video-first-run-plan-v09.md)。

剩余条件是本人明确批准当前一次范围，以及执行当时同scope/最新预估≤70复查。真实模型准入、生成终态、实际产物下载/首帧符合性和最终扣费是获批后那一次任务要得到的结果。正式四岗位guard及账本仍not_checked；不把软件测试或下载资源成功冒充AI作品PASS。
