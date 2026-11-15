# 文字与分镜工作台独立验收（2026-11-15）

指定分支 `origin/codex/creative-knowledge-v04-20261115` 经 `git fetch origin` 获取，确认包含 `0c938971219f61e54b4e3e15ea7e1df9880be61a`，独立实施分支 `codex/creative-workbench-v04-20261115` 从该提交建立。原工作目录未切换、未重置、未迁移数据；原分支仍为 `codex/story-workbench`，HEAD仍为 `b9b6aa1`、工作树干净。原15份项目与历史任务文件的SHA256逐一一致，认证由官方CLI复用，未读取或发布凭据。

本轮软件0.3.0，知识库仍为0.4.0。Windows、Node.js24.22.1、官方Codex CLI `0.167.0-alpha.4.1`；`login status`实际返回 `Logged in using ChatGPT`，`exec --help`包含全部使用参数。独立服务 `http://127.0.0.1:4318/creative.html?projectId=3e875522-d491-478d-acc1-4854643b9ff5`，数据为独立worktree中的 `data/creative-acceptance/`。原4317服务保留。GitHub只供读取源码与脱敏记录，无法访问本机页面或个人数据。

## 隔离测试与真实浏览器

基线在正常Windows权限下最初87/88通过：Git的 `core.autocrlf=true` 把绑定Hash的示例文本转换成CRLF，导致示例字节Hash不匹配。新增 `.gitattributes` 对 `examples/creative/*.txt` 固定LF，未改预存Hash及测试语义，基线随后88/88通过。受限沙箱的rename和loopback限制不算产品失败，正常权限完成以下检查。

| 检查 | 实际结果 | 证据范围 |
| --- | --- | --- |
| `node --test tests/*.test.mjs` | **105/105通过，0跳过** | 原88项加17项回归；隔离runner，不调用真实模型 |
| `node tests/creative-browser-smoke.mjs` | **7项流程通过，4次夹具调用，0页面异常** | 真实Chrome、独立目录；夹具不证明模型成功 |
| `node tests/script-browser-smoke.mjs` | 通过，0页面异常 | 原即梦页面回归；submit/query均0，无真实生成 |
| Windows启动器 `-CheckOnly` | 通过，发现现有Node运行时 | 不安装或修改全局PATH |
| 真实项目Chrome验收 | 5项检查通过，0页面异常 | 读取真实模型候选、人工采用、编辑另存与过期提示；不再调用模型 |
| 独立服务重启恢复 | 三项原任务、原文Hash及三版稿件恢复 | 没有新增或重提任务，人工稿逐字保留 |

回归覆盖当前项目、镜头、预设、知识Hash及来源选择的变化，重复点击去重、缺真实完成终态不得成功、人工原稿与.bak、迟到结果不复活、同会话审阅拒绝、AI实体增量、人工新版本继续分镜。Chrome同时验证同30秒故事、3镜头、两种预设差异、锁不变、静态/摄影/后期三栏、规则来源与案例默认关闭，并让真实轮询跨过脏编辑周期。

浏览器中发现的初始null选项保存失败、轮询可能推进编辑revision、即梦入口跳转问题均已修复并复验。真实页面脚本曾在保存尚未结束时点击禁用按钮而超时，改为等待控件可用后复验通过；没有为此重复生成模型结果。

## 三项真实Codex调用

故事为非个人验收例：阴天傍晚，灰蓝长衫老人留一杯茶，收到离家女儿的平安消息后拉近空椅子，温暖结尾。锁定人物、天气与时间，3镜各10秒。同一剧本先比较 `jia.platform.distance` 和 `anderson.budapest.order` 的确定性编译结果，两种预设提示词Hash不同、人物天气锁一致；仅第二种预设实际提交一次文字分镜。

| 真实任务 | 本地任务ID | 新会话ID | 结果 |
| --- | --- | --- | --- |
| 剧本 | `8547c7c4-f9e6-47f5-bdb2-5859b32a64e5` | `01a1de7e-7545-70d2-b6f2-b0c266550e30` | 退出0、真实turn.completed、完整正文及3段种子通过结构校验 |
| 分镜 | `1692b630-79f9-41b6-bd22-7b2bf7bca8d5` | `01a1de82-7df1-77c1-bdc1-49dfd4eaa17e` | 退出0、真实turn.completed、3镜合计30秒，用户锁保留 |
| 独立审阅 | `8a32f153-32fc-4cbe-88d6-b3e89d3ea51e` | `01a1de86-0dff-7e11-95ee-2e66b2587300` | 退出0、真实turn.completed，六项均PASS，0问题 |

均为新的 `codex exec --ephemeral`，不使用resume；CLI沿用本机已有账号与配置，不换API或其他收费服务。不把账号登录当成免费凭证，不从token用量虚构人民币费用。真实模型正文、逐项审阅证据、用量和原始文件Hash以白名单导出至 [acceptance.json](creative-workbench-evidence/acceptance.json)；完整JSONL、stderr、输入、Schema和回执保留在本机私有runtime。

真实剧本新增 `PROP-02@v1` 手机并明确标注AI补充。首次准备分镜时发现工作区的原三项用户实体遮蔽候选新增实体，导致引用校验400。修复为按稳定ID合并、当前用户同ID版本优先，新增来源保持ai，既有用户实体和锁不变，并新增回归。随后复用同一个成功剧本任务继续分镜，未重新创作剧本。

真实Chrome显式采用剧本及分镜为两个不可变版本，再载入分镜编辑区、追加软件验收人工备注并保存第三版。原模型输出和报告原文保留。人工保存后旧分镜及审阅按Hash规则显示需复核，这是预期结果；原PASS只适用于当时目标候选。重启后这三版、原任务、同会话ID和原文Hash均恢复。

## 截图及未完成边界

- [贾樟柯作品级预设（隔离Chrome）](creative-workbench-evidence/isolated-jia.png)
- [安德森作品级预设（隔离Chrome）](creative-workbench-evidence/isolated-anderson.png)
- [静态、动态与后期三栏（隔离Chrome）](creative-workbench-evidence/isolated-three-zones.png)
- [真实候选采用与人工保存页面](creative-workbench-evidence/real-adopted.png)

本轮未提交图片、视频、配音、即梦画布或即梦剧本任务。正式四岗位guard、15份正式生产文件与账本尚未接入软件，`formalStageStatus=not_checked`，`mediaStatus=not_generated`。真实审阅PASS不能替代正式岗位检查、审美验收或实测时长。下一阶段仍需独立接入正式工作区及媒体连接器，并逐项核实接口、费用、素材引用与实际产物。
