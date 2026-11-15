# 自动出图执行故障修复：无生成验收

日期2026-11-15；基线`7a19ac93aa6d9538dddefccffbe7dd70423411c7`。本轮没有启动Codex模型turn或图像调用。原有1/1应用提交、原失败任务、原始RPC、私有guard和原图保持原状。

## 执行保护的实际边界

[官方Hooks说明](https://learn.chatgpt.com/docs/hooks)允许同步PreToolUse按约定输出拒绝或改写工具参数；启动失败、超时或无法解析的输出并不等同于拒绝。已有真实原始事件证实，原hook以退出码1失败后仍出现图像工具。不能把本地原子marker、模型提示词或夹具成功当成官方严格调用上限。

原始事件时间顺序（`emittedAtMs`，不是新调用）：

| 已有事件 | 时间 |
| --- | ---: |
| hook/started | 1794738909233 |
| hook/completed，failed | 1794738909801 |
| imageGeneration item/started | 1794738909802 |
| imageGeneration item/completed | 1794738936172 |
| turn/completed | 1794738994093 |

失败通知与图像工具开始仅相隔1毫秒。客户端收到失败再请求中断存在传输、排队和执行竞态，不能证明能拦住同一个已经开始的调用。[官方App Server接口](https://learn.chatgpt.com/docs/app-server)的`turn/interrupt`接收threadId、turnId；请求回执、进程退出和服务端图像工作真正停止是不同事件。这里不将中断ack解释为取消成功或退回额度。

**结论：当前渠道无法提供本项目要求的严格单次图像调用保证。** `runCodexImage`和能力检测的真实提交开关继续关闭。新目录、提高应用上限、重复点击或测试参数均不能打开它。下一轮真实图像验收也不能仅凭本轮故障测试自动获准。

## 实际修复

`src/codex-image-watchdog.mjs`提供有明确会话/turn关联的事件期观察器，`src/codex-image-runner.mjs`使用它；真实入口仍在创建CLI、账本和turn之前拒绝。

- 在`hook/started`检查受信脚本和manifest；hook失败、阻断、停止、无效完成或本地等待超时，立即保留第一条保护错误并发出一次`turn/interrupt`，不等整个turn结束才查marker。
- 同步记录中断意图，再发送异步请求，防止重复/并发错误导致多次中断或重提。没有可核实turnId时不补造ID；若原turn/start回执稍后给出ID，再对原turn请求中断。
- turn/start ACK之前的有ID执行事件只暂存，不凭第一条通知给任务绑定turn；ACK之后只回放匹配的会话和turn。runner图片、终态和用量收集复用同一绑定回调，外来turn仅留原始流；没有turnId的线程级用量不计作本turn消耗。
- 同ID重复通知按事件去重；第二个不同hook尝试、多个图像工具项、图像先于准许证据、RPC无效JSON或写入失败都会进入保护故障。外部会话/turn的事件不计入本次。
- 第一条故障不能被之后的`turn/completed`覆盖为成功；停止后续本地成功处理。原连接在中断回执和有界关闭期间继续读取事件，迟到的图像仍保留在原任务回执，不自动导入或重绑。
- marker只证明受信本地脚本走到某一步，不证明原生执行保护原子生效。即便观察完整，`protectionVerified=false`和`strictSingleCallGuaranteed=false`保持不变。

RPC现在额外保存`transport.jsonl`。`requests.jsonl`是写入意图，`written_to_pipe`只是操作系统管道写成功，不能单独称为服务端收到附件；服务端关联回显/回执须另核对。畸形JSON或合法JSON但不合法RPC帧（null、数组、数字、缺结构、错误method/id类型、响应无结果或同时含result/error）都保留原始字节并发送故障诊断，不再静默跳过或导致进程异常。超时后迟到的响应不会被误当作服务器发来的新请求。

## 三种次数分别记录

| 层次 | 可证明内容 | 不能推断 |
| --- | --- | --- |
| 应用提交 | 持久化submit意图、原1/1记录 | 不等于模型已启动或只调用一个工具 |
| 模型turn | `modelTurnRequests`与有ID的`modelTurnsStarted` | 没有ID或超时不能当作没有启动，也不能自动重提 |
| 图像工具 | 按item ID计数的observedImageToolStarts / Completions | 未观测到不能称实际调用为0；流中项数不是服务端精确扣费或隐藏请求次数 |

观察器无事件时，实际工具次数为null；有事件时保留已观察下限，`actualImageToolCalls=null`、`exactActualToolCountKnown=false`。已有原任务的一次开始/完成则作为已有证据单独记录，不追加新次数。

## 无生成故障测试

新增15项watchdog测试和10项RPC管道测试，加原有6项hook测试，共**31/31通过**：

```powershell
node --test tests/codex-image-watchdog.test.mjs tests/codex-image-rpc-fault.test.mjs tests/codex-image-guard.test.mjs
```

启动失败、超时、无效输出和脚本缺失使用实际本地Node无操作进程制造故障，再注入对应官方事件形状。重复/并发、缺ID、ACK前后跨turn、无中断回执和迟到图像使用假RPC。十个管道测试实际启动Node编写的假app-server，验证中断时序、JSON/RPC帧错误、传输记录和原始输出保留，没有执行Codex。

夹具图像始终为TEST FIXTURE / NOT AI；有效hook路径仅在新的隔离测试目录执行本地脚本、写其测试marker，不调用任何图像工具。没有在原失败guard中补写或重跑marker。测试证明应用的故障处理与保留行为，不证明官方图像工具能被严格限制为一次，也不证明真实参考使用。

附件Schema与各层证据应同时读取本轮独立附件契约记录；`inputImages`缺省不是协议违规，其存在也不是服务端语义使用或画面一致性的保证。
