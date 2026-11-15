# GitHub 发布与后续调试

发布日期：2026-11-15（Asia/Shanghai）。

- 公开仓库：https://github.com/499893181-lang/AI-Drama-Studio
- 默认公开分支：`main`；本地开发分支保留为 `codex/story-workbench`，原基线历史保留。
- [网页版调试入口](CHATGPT_CONTEXT.md)、[源码索引](../llms.txt)、[架构](architecture.md)和[实际验收](validation.md)均随源码发布。
- 发布的是 MIT 源码、测试、开发文档与自建验收截图；本机 `data/`、认证文件、缓存、浏览器profile与大型媒体未纳入Git。
- 本次发布只补充阅读入口与发布文档，没有修改运行代码或重新提交模型/媒体生成任务。

## 网页版读取

先提供仓库和调试入口链接，再列出相关源文件与具体错误。需要固定版本时使用提交SHA链接；原始文本可从文件页面的 Raw 入口读取。若当前会话不能读取页面，上传相关文件即可。公开仓库不代表任何模型自动同步、完整索引全部代码或直接连接本机服务。

原始入口：https://raw.githubusercontent.com/499893181-lang/AI-Drama-Studio/main/docs/CHATGPT_CONTEXT.md
源码索引：https://raw.githubusercontent.com/499893181-lang/AI-Drama-Studio/main/llms.txt

## 后续同步

在本地项目目录修改、验证并提交后，将当前版本推到默认公开分支：

```powershell
git status
git add -- <本次改动的文件>
git commit -m "说明具体修改"
git push origin HEAD:main
```

推送前核对变更文件，保留 `.gitignore` 对私有数据的排除。不要将账号密钥、个人故事、认证文件或原始运行缓存放进公开的调试日志。若远端已有更新，先获取并核对后再合并，不强制覆盖远端历史。
