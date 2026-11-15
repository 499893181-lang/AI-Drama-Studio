# 即梦CLI实际认证检查结果

检查日期：2026-11-15（Asia/Shanghai）。本记录仅保留认证状态与脱敏错误；不包含授权链接、设备码、用户码、token、cookie、账号身份、积分余额或本机用户路径。

| 工具 | 实际版本 | 初检 | 本轮官方授权流程 | 最终检查 |
| --- | --- | --- | --- | --- |
| `dreamina` | 1.4.22 | `user_credit`返回「未检测到有效登录态」 | 实际运行`dreamina login`，打开并提供CLI返回的官方设备授权链接，保留原进程等待；最终exit1：「登录已过期，请重新执行 dreamina login」 | 再次`user_credit`仍返回未检测到有效登录态，未确认登录成功 |
| `dreamina-canvas` | 1.2.0 | `auth status`返回`loggedIn:false`，默认profile、cn区域 | 实际`auth login`取得挑战；打开并提供官方链接；按`auth wait`等待，首轮`cli.login_wait_timeout`要求resume；复用原挑战再等待一次，返回`cli.login_expired`、`requiredAction:login` | 再次`auth status`仍返回`loggedIn:false`，没有服务端已认证账号查询结果 |

本次两个工具均未在挑战有效期内返回授权完成。打开页面或发出挑战不等于已登录；没有把等待超时当作成功，也没有导出或移植凭据。本轮没有执行logout、relogin、force、刷新凭据命令或清空任何凭据存储。

## 当前阻塞与继续方法

**登录仍阻塞于本人完成官方网页授权**。原挑战均已过期，旧链接不能继续使用。需要在同一Windows用户会话重新运行对应官方命令，打开它返回的新链接并完成授权：

```powershell
dreamina login
dreamina user_credit

dreamina-canvas auth login
# auth login返回授权挑战后，使用它本次的设备引用等待，不复用本记录旧挑战
dreamina-canvas auth wait --device-code <本次deviceCode> --timeout 10m
dreamina-canvas auth status
dreamina-canvas auth account
```

以上是后续操作说明，本记录不包含可复用的设备引用。不要在公开GitHub issue或提交中粘贴授权链接、设备码、账号详情或凭据。登录结果必须按CLI真实完成回执及只读账户验证确认；本轮明确未完成。

若本机后续已有可用登录态，应直接复用，不为了运行以上示例再次登出或强制授权。`auth account`只在画布登录成功后用于服务端身份核验；本轮未登录所以未执行该查询。

## 与短剧创作CLI的区别

官方独立`jimeng-novel 1.0.6`已隔离检查帮助与Schema，`status -j`返回`logged_in:false`。没有为它发起第三条授权，也没有从任一工具的状态推断其他工具已登录。它的AI剧本调用契约与尚未证实的修改接口见[独立检查报告](jimeng-cli-audit-2026-11-15/script-cli-report.md)。

本轮没有提交剧本创作/修改任务，也没有启动图片、视频、配音、画布创建或任何媒体生成。
