# 自动出图契约修复0.5.1：无新增生成验收

日期2026-11-15。基线`codex/auto-image-v06-20261115`包含`7a19ac93aa6d9538dddefccffbe7dd70423411c7`；独立实施分支`codex/image-contract-fix-v061-20261115`。本轮**新增应用提交0、模型turn 0、图像生成0**，未启动即梦画布、视频、配音或剪辑。

已完成事件期故障处理、附件契约纠正、分层状态与追加诊断。**现有官方边界不能提供严格单次调用保证，自动入口保持关闭。** 本轮测试通过不等于原失败任务转为成功，也不构成下一次真实调用授权。

## 已修复行为

1. hook启动失败、超时、无效输出、脚本缺失或重复/并发时，事件期watchdog立即保留第一条故障并请求一次`turn/interrupt`，不再等整轮结束才检查marker。异步中断ack不等于工具已停止，也不能撤销已发生调用。迟到产物和终态留证据，不覆盖第一条故障、不自动重提。
2. 记录应用提交意图、模型turn请求/ack、图像工具开始/完成事件四种计数。未知保持null；按item生命周期去重。观测一次不代表服务端严格只处理一次，应用1/1也不是工具执行次数硬上限。
3. RPC分开保存请求意图、实际管道写入状态及官方响应。只写请求日志、写管道成功、会话回显、工具读取和远端使用是不同证据，不互相替代。
4. 诊断存于原DATA_DIR的独立`image-generation-diagnostics/`，原任务JSON、错误、回执、guard和图片只读。诊断绑定原任务字节、request/packet/input Hash和证据文件Hash；损坏或过期时保守显示未核实。没有HTTP提交诊断的接口，避免客户端自报证据升级真实结果。
5. 同页分开显示“真实图片已产出”“执行保护未验证”“参考使用未验证”“候选未通过完整验收”。手工导入继续可用，隔离素材明确标注，不把图片存在显示成全部通过。

## 真实Schema及附件结论

重新执行本机`codex app-server generate-json-schema --experimental`，没有模型turn。CLI仍为0.167.0-alpha.4.1，完整Schema SHA256为`d9dc3bfe984335642465586c94117e90adb11943c94d8142d0a906221f092e44`。

- imageGeneration分支的required为`id/status/type`；`inputImages`是**非必填array，没有default**。缺省是允许情况，不是官方违反必返契约，不能补为空数组。
- 若返回，元素要求`path/sha256`；字段语义是本次图像请求成功读取的本地文件及归一化前字节Hash。Schema描述要求小写SHA256，但没有额外正则；本工作台另外验证元素和Hash。
- `inputImages`证明的范围是本地读取，不能当成远端模型使用回执或画面符合参考的证明。详细字段约束见[附件契约复核](image-reference-contract-v061.md)。

原任务七层证据：

| 层次 | 实际结论 |
| --- | --- |
| 计划参考 | 1份明确TEST FIXTURE / NOT AI的色块参考，仅是计划 |
| 实际会话发送 | 请求日志及同turn的官方userMessage回显共同证明传递 |
| 会话接收 | 回显1个localImage路径；没有官方附件文件Hash |
| 图像工具参数 | 未核实：原hook失败，无可信参数记录；原生图片事件不包含工具参数 |
| 图像请求本地读取 | 未返回inputImages，保存null，不能解释为0参考或已使用 |
| 服务端参考使用 | 未找到已验证的独立回执，不能以本地读取替代 |
| 视觉符合要求 | 仍需独立检查，协议、Hash和解码不替代视觉判断 |

官方允许PreToolUse观察调用前`tool_input`并请求`updatedInput`改写；新增guard把实际stdin、入参Hash和manifest绑定追加到私有`hook-inputs.jsonl`，另记请求改写的参数，UTF8输入及单记录限1MiB。两者都明确不证明最终工具执行或后端使用，非法/缺失/过大输入拒绝放行。本轮原hook未进入脚本，没有该层证据，也不追补原记录。具体来源及范围见[官方契约复核](image-reference-contract-v061.md)。

## 严格单次调用结论

原始事件中hook失败的`emittedAtMs=1794738909801`，图像工具开始为`1794738909802`，只相隔1毫秒。这是已有事件的重读，没有新增调用。客户端收到故障再异步中断，不能保证拦住已经开始的工具工作。

现有hook错误可能继续执行；没有本次已核实的原子拒绝及严格工具次数上限。因此**不能支持严格单次调用保证**。能力检测及runner均在真实提交前拒绝，新目录、上限修改、提示词和成功夹具都不能开放入口。机制及故障测试详见[执行故障修复](image-execution-faults-v061.md)。

## 测试与原记录保留

`node --test tests/*.test.mjs`：**215/215通过，0失败**。基线171项，新增watchdog15项、RPC管道10项、附件证据11项、追加诊断7项、hook输入观察1项；全部为本地故障注入与隔离数据，不调用真实模型。

真实Chrome：分层状态隔离7项、既有自动候选隔离5项、已有真实图片只读5项，均0页面异常；原失败产物浏览器3项和手工上传/换图/旧包/重启7项也通过。启动失败/超时等测试使用本地Node无操作脚本，RPC测试使用Node假app-server，不执行Codex模型。测试PNG不是真实生成证据。

本机服务已切换到0.5.1，**复用原来的DATA_DIR及maxSubmissions=1**。除随服务重启更新的studio.lock进程锁外，原499份data文件逐一Hash相同，只新增1份独立诊断；原任务及备份、RPC、guard、原图与参考均未改。原marker前后均不存在，没有补marker或重置账本。原失败任务仍failed、result=null，错误原文不变，提交1/1、剩余0。

原图片仍为1672×941 PNG，SHA256 `bbe2683b21c5362a8cd501e322310ad716437c6fe4afb431de7897dd486c6738`，本轮重新核对与原官方base64字节一致并实际Chrome解码。原图像与turn终态completed，足以显示产物存在；不能据此宣称执行保护、参考使用和完整候选验收通过。

[脱敏机器证据](image-contract-v061-evidence/check.json) · [实际四状态](image-contract-v061-evidence/real-four-states.png) · [真实附件证据分层](image-contract-v061-evidence/real-attachment-layers.png) · [隔离UI夹具](image-contract-v061-evidence/isolated-fixture-statuses.png) · [原有唯一真实图片](auto-image-evidence/real-image.png)。

费用仍分别为未知：本轮没有购买额度、配置付费API或增加生成；不以既有窗口百分比或余额推算单图费用。正式四岗位guard及账本保持not_checked/未接入，不伪造PASS。

## 页面与复核

本机入口：`http://127.0.0.1:4320/images.html?projectId=2fabba3a-6f4a-4b2f-b714-8506a4b42f64`。服务使用新worktree代码、原v06数据目录；原4317/4318/4319服务保留，原工程未提交内容不动。重启时继续设置原`DATA_DIR`，不新建目录清零次数。

`scripts/audit-image-evidence.mjs`只读已有原文件，在新worktree忽略目录输出审计；`scripts/append-image-diagnostic.mjs`只追加这份已绑定原文件Hash的诊断；`scripts/verify-image-diagnostics-local.mjs`只读浏览器检查；`scripts/export-image-contract-check.mjs`导出白名单脱敏证据。上述脚本不发起生成。

## 下一次真实验收所需范围

先获得并验证官方可执行的硬性次数限制或等价的执行前默认拒绝机制；若仍只能依赖失败可继续的hook和异步中断，不进行新的真实生图验收，自动入口继续关闭。

条件满足后，再由用户明确新增授权：在保留原1/1及失败任务的基础上，另记一次新授权，最多一个模型turn、一笔图像调用、一张图片；沿用现有账号，不购买额度或切换API。用一份明确来源的实际参考，保存调用前参数、请求/会话回显、工具本地读取Hash及官方可提供的回执，取得真实产物后独立视觉检查，分别验收产物、保护、参考及候选。缺证据仍记未知，不再次重试；本PR不执行此范围，也不提前重置旧记录。
