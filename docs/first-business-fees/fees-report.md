# 首次业务验收：剧本费用核验

日期：2026-11-15（Asia/Shanghai）。只读核验当前已登录的 `jimeng-novel 1.0.6`；没有发起授权、提交剧本/媒体任务或修改任何画布。账号身份、空间标识、余额、设备码与凭据均未进入本报告。

## 结论：不能确认本次CLI文字生成免费

本轮成功读取了官网链接的**完整官方命令文档**。第8节“剧本”在列出 `script outline`、`script episode`、`script result` 后，明确规定剧本按产出字数计费，并且不提供总价预检。第6节另明确指出，未知报价不计入合计不代表免费，剧本不受 `credit estimate` 总价预检支持。

| 操作 | 已确认的渠道与计费规则 | 本次可确认价格 | 免费权益结论 |
| --- | --- | --- | --- |
| `script outline` | `jimeng-novel` CLI文字渠道，线上模型scene为 `web_novel_script`；适用官方“剧本按产出字数计费”通用规则 | 总额、单位费率与计数细则均未返回，不能伪造为0积分或人民币 | 未取得当前账号对该CLI操作的免费额度、适用条件及有效期，不能按免费提交 |
| `script episode` | 同一CLI文字渠道；默认模型 `script_bird` / DreamScript的公开描述同时列出这两个命令 | 同上；生成前不能根据目标30秒推算实际产出字数和应扣积分 | 同上；网页免费活动不能自动证明本账号CLI免费 |

官方 `novel_cli` 授权页的公共说明确认创建生成任务的积分消耗与网页端一致，并要求以平台规则及实际消耗记录为准。这说明结算来源是平台积分记录，**不提供每字积分费率，也不证明任何网页限免对当前CLI调用有效**。本轮没有人民币价格或积分兑人民币的公开依据，没有生成官方quoteId，也没有虚构兑换率。

因此本轮应保留已完成的真实画布绑定、30秒输入和待提交任务，并显示“费用待确认”；不能用试调用来反推费用。需有适用于当前账号/空间、具体操作和CLI渠道的明确免费凭证，或可供用户确认的明确费用依据后才能提交。

## 已完成的真实只读检查

1. 本机实际 `script outline/episode --help` 与相应 `schema get` 均已读取。没有价格、免费次数或费用预检参数。
2. `credit estimate --help`明确适用图片/视频/音频节点或模型参数；不能把它给出的媒体节点价套到剧本。
3. `account get -j --full`实际成功，当前公开返回只有基础身份字段，没有会员计划、剧本免费额度、单位费率或有效期字段。本报告只保留字段名，未保留身份值。**这不证明账号没有权益，只证明本接口未提供可核验的相关权益。**
4. `credit get -j --full`实际成功，只返回余额、空间及单位，不返回具体script价格或免费次数；余额数值未保存到公开证据。
5. `model list --type text -j --full`实际成功，目录中默认模型为 `script_bird` / DreamScript，scene为 `web_novel_script`。`model describe --model-id script_bird`实际返回支持outline/episode，但没有单价或免费条件。模型目录可见不等于免费或任务准入已验收。

## 官方网页与指南

- [官方安装页](https://jimeng.jianying.com/ai-tool/install?from_page=banner)已用隔离浏览器实际渲染；当前文案列出短剧CLI并提示内测期间仅限会员。网页营销或搜索缓存里的“免费解锁短剧创作”等文字，没有提供这两项CLI操作针对本账号的资格、剩余额度与期限，未作为免费提交依据。
- [官方授权页](https://jimeng.jianying.com/ai-tool/cli-auth?cli_name=novel_cli)不带挑战码时只显示授权链接无效。没有为了读文案重新登录；读取了该页实际加载的官方中文资源，只提取 `dreamina_novel_cli_sync_and_credits_notice` 等公共字段，不读取或复用旧授权码。
- [官方使用指南](https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg)本轮通过真实浏览器成功读取及滚动；页面给出以下完整命令文档链接。本轮不再沿用先前“指南无法读取”的诊断。
- [完整官方命令文档：积分与报价](https://bytedance.larkoffice.com/wiki/M9ejwOcQwizqezkUhJEc4hc7nxf#doxcnoS0M1IxQ4qn51A6fabEsFd)和[剧本](https://bytedance.larkoffice.com/wiki/M9ejwOcQwizqezkUhJEc4hc7nxf#doxcnLOMI9XBuzxtM6YjtnDQaqh)均通过匿名浏览器实际滚动读取。仅保存相关官方正文，不把页面评论或其他产品的免费条款作为证据。

## 当前具体缺失的依据

- 对 `script outline` 和 `script episode` 分别生效的每字积分单价、最低计费数量及计数规则。
- 若主张免费：当前账号/空间的CLI专属免费额度、适用操作、使用条件、剩余次数及生效/截止时间。
- 若按付费执行：本次可供确认的明确费用总额或可靠上限。官方说明产出字数计费且无总价预检；30秒目标时长本身不是计费上限。
- 人民币计费或积分兑换人民币的依据；目前没有，不能补写换算。

有效期只能记录为“未公开/未取得”，不能凭检查当天自行生成一个官方有效期。证据观察时间与价格生效时间是不同字段。

## 可提交材料

精选脱敏材料保存在 `fees-evidence/`：本机公开帮助与Schema、官方授权说明、已实际读到的官方计费段落、基础账号接口字段清单、当前文字模型目录与默认模型描述，以及分别列出的outline/episode费用结论。它们不包含原始账号回执、余额、浏览器profile、完整网页/公共JS或任何授权材料。

本报告没有把未知费率解释为免费，也没有通过真实提交探测价格。
