# 待本人授权的画布执行适配器

`src/canvas-execution.mjs`独立于0.7.0的纯准备适配器；后者的submit/confirm仍硬关闭。新执行适配器默认没有可信批准校验回调，任何来自HTTP、JSON或环境变量的自报授权都不能调用消费确认或生成。本轮没有发起真实confirm/run，隔离fixture只验证软件流程。

## 范围与授权

`inspectPlan(plan)`只读读取实际版本/Schema、当前认证与个人空间、两节点及同节点报价。首次范围固定为`seedance_2.0_vip`、首帧、5秒720p、16:9、count1。最新最大预估超过70或未知时阻断，不把70写成最终结算或平台绝对扣费上限，也不将账号余额当报价。

返回`authorizationBinding={scope,scopeHash}`。scope包含本地项目/任务、图片与分镜bindingHash、inputSnapshotHash、画布/视频节点/来源图片节点/资源ID、原输入与平台注册资源Hash、草稿版本、完整参数及提示词、当前region/profile和消费主体Hash。个人身份明文不写入回执。换账号、输入或草稿后旧scope失效；报价requestId更新但同一范围仍有效，实际金额始终重查。

grant同时须有本机可信签名校验、当前scope匹配、本人批准时间与有效期、一次任务和不超过70的预估批准阈值。本机签名库与批准入口由服务层负责，浏览器不能签发。模型实际准入、真实生成终态与首帧符合性是获批后首次任务的验收内容，不要求先付费证明。

## 执行与恢复

服务层先持久化意图和稳定submitId。适配器重新回读/报价，调用可信beforeConfirm校验本地版本，再回读并核对完整范围后确认。确认短期token仅在内存里传给单节点run，绝不出现在回执、日志、argv证据、Git或任务JSON；错误回显也删除。无效或畸形确认不继续run。

确认后仍重新回读/报价，运行前调用beforeRun、再次回读并校验scope与授权。每个最终网络回读后再次运行真实本地beforeConfirm/beforeRun回调，网络期间的人工编辑或取消不能凭旧本地检查继续。官方run参数只有节点、submitId和消费token，没有expectedDraftVersion条件参数；因此应用可以阻断观察到的变化，不能宣称服务端原子锁住了最后回读与run之间的草稿。返回的generationDiff如存在会保留供人工复核，不覆盖原计划。

同一进程重复/并发submit共用同一个Promise；一旦尝试confirm，即使结果未知也不重放。跨重启由服务层持久化意图和原submitId控制。响应丢失或未知只查`operation status <原submitId>`，不能因absent或unknown就另起一次。只有匹配operationRef的succeeded终态、已返回submission须completed、唯一succeeded资源以及实际`resource get`核实同ID/type=video/status=success，查询才标成功；受理不等于成功。operation查询契约不返回nodeId，不补造这一字段；节点关联依靠已持久化的计划/原submitId以及run受理回执中实际返回的nodeId对应关系。响应丢失时保留该证据范围，而非伪造缺失回执。

下载先查询原操作核对成功资源，再调用官方resource download；失败只恢复下载，输出必须是新路径、不能覆盖旧片。实际下载回执、文件Hash与FFprobe由严格下载模块和服务层核验，不能只凭路径认定候选成功。新产物作为候选，人工检查与选用分开。若需静音，保留原片并本地派生、实测无音轨；不冒称模型原生无声。

所有注入runner或resolver的执行证据强制标记`isolated-fixture`，即使夹具自报官方成功也不改变。官方没有返回`generationDiff`时不补null；显式null、空列表和实际差异分开保留，不能据此补造“实际参数无变化”的回执。正式四岗位guard和账本保持not_checked。新增适配器隔离测试覆盖无授权、超限/未知报价、scope变化、确认期间改稿、取消、重复并发、原ID查询、未知结果、下载恢复和token错误回显；这不等于真实模型准入或生成验收。
