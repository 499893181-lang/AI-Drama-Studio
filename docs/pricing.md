# 剧本费用依据与单位预算

本轮价格模块不再把“必须有人民币金额和quoteId”作为唯一格式。它可以表达有真实依据的免费、积分和人民币费用，同时保持未知费用不得提交。实际当前账号的结论仍为**大纲与单集费用待确认**，没有写入任何“免费”政策记录或虚构价格。

## 当前实际依据

[即梦短剧CLI官方指南](https://bytedance.larkoffice.com/wiki/M9ejwOcQwizqezkUhJEc4hc7nxf)第6节和第8节说明剧本按产出字数计费、不支持总价预检，未知报价不等于免费。尚缺当前账号CLI渠道的每字单价、计价币种、适用条件，以及outline与episode的分别规则，不能由“按字计量”推算一笔总价。

默认报价对`outline`和`script`分别返回unknown，`amount/currency/unit=null`、`canSubmit=false`；附来源、适用动作与`metering:{basis:'output_characters',unit:'字',unitRate:null,prequoteAvailable:false}`。这里“字”是计量单位，不是人民币或积分单位。官方有效期未注明，如实记录`validity.kind='not_stated'`，没有编造到期时间。

## 本地证据记录

`createScriptPricing({rootDir})`只从被Git忽略的`data/pricing/script-evidence.json`读取`records`。HTTP请求不能传入报价覆盖它，也没有公开“填写任意金额即放行”入口。无文件、损坏、未核验、过期或不适用时返回unknown。

正向价格记录必须由实际官方政策或官方回执核验后维护，字段包括：

- `channel:'jimeng-novel-cli'`，以及精确的`actions:['outline']`或`['script']`；不能将网页权益推广到CLI，不能将大纲免费推广到单集。
- `billingType:'free'|'credits'|'money'`、明确`amount`、`unit:'次'|'积分'|'人民币元'`；若填写currency，只允许与其定义对应的FREE/CREDITS/CNY。美元等币种或缺失计价单位不能被默认为人民币，不做汇率换算。
- `sources`保留官方HTTPS政策URL、标题及与价格直接相关的摘录，或实际CLI帮助/账户回执的命令、原文摘要SHA256、字段路径与摘录。授权query、设备码、账号身份和原始账户回执不得混入公共来源。
- `conditions`列出适用渠道、动作和权益条件；`verification`需`verified:true`、`conditionsMet:true`、真实`checkedAt`和核验依据`basis`。这只是人工核验记录，不代表脚本能够理解或自动证明政策语义。
- 如有`verification.accountScope`，必须与运行时上下文`verifiedAccountScope`一致；仅在记录里自称当前账号不算匹配。可通过服务端`getContext`提供实际核验后的范围，HTTP客户端不能覆盖。
- `validity.kind='until'`时保存官方实际到期时间；官方未注明则用`not_stated`且不填推算日期。模块另设默认30分钟本地证据复核窗口，它是本地安全策略，**不是官方免费或报价有效期**；超出后要求复核，不能永远沿用旧观察。

新报价的`evidenceId`为`local-evidence:<sha256>`，明确是本地证据标识。没有官方编号时`officialQuoteId=null`；模块不生成官方quoteId。旧测试或外部明确注入提供方的quoteId仅保留兼容，不会由默认生产提供方创建。

同动作最新记录失效、被撤销或损坏时不会回退到旧的便宜/免费记录。单独维护大纲与单集，不共享未经证实的价格。

## 提交和预算

`ScriptService`在prepare、submit时传入具体kind与当前workspace；GET同时返回`costEstimates.outline`和`costEstimates.script`，旧`costEstimate`兼容为单集。提交重新取价、重新读取任务状态及当前输入Hash，价格、来源、适用条件、单位或有效期变化都必须重新准备确认。

- FREE：只接受有核验依据的free且amount=0，不要求虚构人民币预算或积分换算。
- CREDITS：要求明确保存`workspace.spendingLimits.credits`积分上限，只汇总此前同单位提交的预留费用。人民币上限不能替代积分上限。
- CNY：使用原项目`budgetCap`人民币上限，只汇总同币种提交的预留费用。

不跨单位相加，不自动退款或把失败调用当作零费。预留金额不是最终官方扣费账单；实际退款/实付必须由真实回执另外核对。费用未知始终阻断，但不阻断此前已接受任务按原thread/run查询，也不影响人工稿与独立审阅。

页面和每条任务分别展示动作、金额/单位、来源、条件、检查时间及有效期。待提交任务保留其原费用快照，不能用页面后来显示的另一动作价格代替。

## 测试边界

`tests/pricing.test.mjs`只使用明确标记的离线假政策、临时数据和假adapter，不把任何免费/积分/人民币示例当作真实官方报价，也不执行CLI或生成。覆盖网页/渠道/动作错配、账户范围、来源与授权材料拒绝、有效期、不同单位、预算预留、最新记录撤销、伪HTTP报价无法绕过，以及服务分动作显示。
