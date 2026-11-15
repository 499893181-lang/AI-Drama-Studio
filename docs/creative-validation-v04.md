# 创作规则核心验证（2026-11-15）

工程基线：`2fecee1aaee195fc4fcb52c2927aded5f6e87fdd`。知识库版本0.4.0；现有工作台版本0.2.1。

在Linux、Node.js 24.22.1中执行：

```text
node --test tests/*.test.mjs
tests 88 / pass 88 / fail 0 / skipped 0

node scripts/preview-creative.mjs --list
17个作品级预设

node scripts/preview-creative.mjs examples/creative/waiting-shot.json
structuralStatus: valid_draft
appliedRules: 15 / contextRules: 2
formalStageStatus: not_checked / mediaStatus: not_generated
findings: reference_not_attached
```

原有72项测试保留，新增16项，覆盖真实知识库字段与来源锚点、同场景预设差异、用户锁冲突、静态／动态分离、视点与首帧、焦点与变焦分离、固定／复合运动、参数白名单、附件声明、过期输入及模型PASS隔离。图像与运动提示词中的已应用规则均可追溯到实际文本；声音及叙事规则留在上下文。

审查中发现的三处问题已修复并回归：首帧遗漏视点；固定机位自由路径绕过；来源改变未进入知识Hash。导入另需调用方提供最新镜头输入Hash，避免旧任务包与旧回答互相匹配而误用。三个Word的Git blob与用户附件一致，原手册未修改。公开增量只保留转译规则和来源位置索引，不重复发布手册全文提取或链接集合。

本轮没有运行Windows启动器、浏览器界面验收、真实Codex创作、图像／视频／配音调用、即梦画布写入、四岗位guard或正式账本。测试与预览只证明离线核心在上述环境下的行为，不能证明创作质量或整条制作链已经上线。个人data与认证未读取或修改；现有HTTP服务和界面未改。
