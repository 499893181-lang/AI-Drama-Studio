# 实体来源校验与历史记录（0.5输入契约）

原始实体的 `source` 只是声明，不能独立证明新增设定来自用户。当前服务端保留原声明、模型正文和原始回执，另生成 `entityProvenance`；界面和下游使用其中的 `resolvedSource`，不把原 `source="user"` 直接当作用户事实。

来源状态分为：

- `verified_user_input` / `resolvedSource=user`：真实人工新建或修改的输入记录，或完整实体描述与允许的用户输入摘录逐字一致。
- `ai_addition` / `resolvedSource=ai`：明确声明AI补充，并在 `addedSettings` 中逐项保留该实体完整描述与说明。
- `pending_confirmation` / `resolvedSource=pending`：缺证据、说明不足、快照/位置不匹配或历史记录无法证明来源。保留原因和原文。

字符证据只证明来源文本一致，不能自动理解实体语义、否定条件或剧情合理性。描述经过概括、合并或加入额外事实，无法逐字覆盖时不会自动核实为用户指定，可以作为AI补充或待确认候选继续编辑。

## 模型输出与可信快照

新剧本输出增加顶层 `entityEvidence` 数组。每条含 `entityId`、`version`、`path`、UTF-16的 `start/end`、`quote`、`snapshotHash`。`description` 必须逐字等于该摘录，位置、快照Hash和完整描述同时匹配。允许路径只有 `source.idea`、`instructions`，以及服务端有实际人工输入证明的 `entities.N.description`；AI创作说明、生成结果、AI实体及自己的输出不能作为用户来源证据。新ID不一律归AI：例如用户原文里的完整人物描述可据此建立新人物ID。

示意（Hash与偏移必须取自该次真实快照，不可照抄）：

```json
{
  "entityId": "CHAR-02",
  "version": "v1",
  "path": "source.idea",
  "start": 0,
  "end": 4,
  "quote": "独居老人",
  "snapshotHash": "<本次完整输入快照SHA256>"
}
```

服务端侧录绑定完整输入快照Hash、实体五个核心字段的Hash、证据及结论。模型不能提交可信侧录。采用时重新校验原快照与任务 `inputHash`，再验证侧录和当前存储；下游引用再次检查绑定。版本继承的来源base保留独立的 `expectedSnapshotHash`，不能靠修改后的快照和报告互相证明。损坏的绑定不会经下游合并恢复成已核实来源。

来源待确认的候选可以保留，但采用必须明确发送 `confirmPendingSources=true`。确认只授权保存仍待确认的候选，版本记录 `remainsPending=true`，不会提升为用户事实或自动事实锁；图片手工导入仍可继续并显示提示。结构候选成功、独立模型审阅PASS和来源证据有效是不同状态。

## 人工输入与旧数据

工作台真实新建或修改实体时，服务端按实体核心字段Hash记录 `entityInputEvidence`，客户端无法通过同名参数提交可信证明。相同实体数组的保存、轮询或复制旧记录，不会给缺证据的旧声明补造证明。人工填写AI来源仍保留AI分类。

历史任务缺少侧录时，只在读取视图中显示待确认；不修改旧JSON、正文、原始回执或不可变版本。人工版本继承的AI补充及用户证据继续绑定原来源，手动改剧本文字不会把继承的待确认实体洗白。当前用户实体同ID的实际修改仍优先，变化使旧候选和相应图片需要复核。

## 验证

`tests/entity-provenance.test.mjs` 的13项隔离回归覆盖伪造用户来源、合法新ID摘录、夹带设定、错Hash/位置/路径、合法AI补充、缺说明、采用确认、旧记录不改写、相同数组不洗白、损坏侧录、联合修改快照/报告及版本继承。与原17项创作工作台回归组合实际30/30通过；原Chrome隔离创作流程复验通过，4次夹具调用、0真实模型/媒体调用。完整测试与图片浏览器结果以本轮总验收记录为准。
