# 第二阶段 jimeng-novel 适配边界

适配以仓库保存的 `jimeng-novel 1.0.6` 官方帮助与Schema为依据，不调用文本节点来冒充Agent剧本创作或修改。所有真实创作都必须经过服务端的费用、预算与用户确认门禁；适配器本身不自动登录、创建画布、重试提交或启动任何媒体生成。

## 安装与查找

完整Windows发行包保存在被Git忽略的 `.local/jimeng-novel-1.0.6/`，包含原发行的exe与配套 `runtime/`。路径发现顺序为明确 `JIMENG_NOVEL_BIN`、项目 `.local/` 的完整发行目录、PATH中的原生程序；明确配置无效时不悄悄切换到其他安装。没有配套runtime的单独exe不视为可用安装。

`scripts/setup-novel.ps1 -ArchivePath <官方WindowsZIP>` 根据已核实的SHA-256解压完整发行结构；不下载、发起授权、修改全局PATH或覆盖已有不完整目录。`-CheckOnly`仅检查当前目录及版本。SHA来自此前公开发行检查记录；升级版本需重新核对官方制品并更新记录。

真实子进程只为自己的PATH前置工作台当前Node.js目录，复用工作台的Node运行时，以适配普通Windows PATH没有Node的情形；不更改用户或机器PATH。官方程序仍保留自身配套runtime目录。

## 接口

`createNovelAdapter({ repoRoot, rootDir, bin, runner })` 中 `repoRoot` 是源代码目录，`rootDir` 是私有data根目录。`bin`用于明确指定原生程序。`runner`仅供隔离测试注入，默认以参数数组执行真实程序，禁用shell并隐藏窗口。

- `inspect()`：实际读取版本和 `status -j`，不自动授权。报告是否安装、是否登录；登录不代表画布访问或费用已验证。
- `verifyBinding({projectId,teamId})`：只读 `canvas get --project-id ... -j --full`，必须成功返回同一个 `data.projectId` 才确认绑定。默认空间保持空字符串，不擅自改成个人空间0。
- `submit({kind,binding,input,requestId,onReceipt,signal})`：只支持 `script outline` 和 `script episode`，按公开Schema校验输入，通过UTF-8 JSON文件提供 `--input-file`；request-id必须在服务端事先持久化。`kind:'script'`映射到episode。
- `query({threadId,runId,teamId,onReceipt,signal})`：仅调用 `script result` 查询原任务，绝不重新执行submit；缺原IDs则拒绝猜测或重提。

每次调用都会使用独立的 `data/runtime/novel-*/`，保留输入JSON、CLI原始stdout/stderr、退出码、解析信封、时间与本次正文文件。这些私有数据不应上传GitHub。页面只展示脱敏错误和经确认的候选正文，原始业务回执保留供本地追踪。

## 成功与恢复判定

公开Schema未完整声明剧本结果正文的JSON字段，因此适配器不尝试把任意 `data.text`、日志或嵌套字符串猜成剧本。使用官方支持的 `--out`，其帮助明确只在任务成功后写完整正文；同时指定 `--full`。只有以下条件全部满足才产生成功候选：

1. CLI正常退出，未超时、未中断、未超过输出限制。
2. 返回真正成功终态，且没有明确的运行中/失败/截断标记。
3. 已保存有效thread_id与run_id；查询可沿用事先已保存的原IDs。
4. 本次唯一调用目录中产生新的非空正文文件。

`status=running`即使exit0或出现文件也不算成功。空成功包、缺正文、缺ID、截断或无法识别的回执保守记为 `uncertain`，不产生候选；正文的剧情完整性仍由独立审阅与用户核对，文件存在不等于内容质量通过。

收到可解析接受回执时，`onReceipt`可以先保存thread/run；回调收到与最终结果同形的对象，partial回执的 `receipt.partial=true`。进程错误、超时或AbortSignal中断不会被当作“任务未创建”，已经接收的IDs及原回执尽量保留，后续查询原任务。适配器没有任何自动重提路径。

## 费用门禁

`scriptCostEstimate()`固定返回 `status:'unknown'`、`label:'费用待确认'`、`amount:null`、`currency:null`、`canSubmit:false`，并说明公开剧本契约缺少可核验报价。余额、节点图片/视频估价和用户预算上限不能变成剧本价格。服务层必须据此阻止未知费用提交；没有向界面开放人工填写报价来绕过门禁。

## 隔离验证

`tests/novel.test.mjs`只使用明确标记的假runner和临时目录，不执行fixture exe，不连接即梦，不消耗生成额度。覆盖完整发行发现、认证只读、真实ID绑定判定、公开Schema与参数、request-id/回执、成功与空包区分、running exit0、缺正文/截断、原ID恢复查询、提前保存ID、AbortSignal与无效输入。生产默认路径始终调用实际CLI，不返回测试预设正文。
