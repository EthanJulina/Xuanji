# 玄机 IPC API 参考

> 通道约定：`<域>:<动作>`。渲染层经 `window.qd.<方法>()` 调用（`electron/preload.js` contextBridge 暴露）。
> 标注 **v2.1** 的为 P1 轮新增；其余为 P0 已有。

## app / 窗口

| 通道 | 入参 | 返回 |
|---|---|---|
| `app:info` | - | `{ version, dataDir, justMigratedVersion }`（**v2.1** 加迁移标志：`'2.0'`/`'2.1'`/空） |
| `app:quit` | - | - |
| `win:close` / `win:hide` / `win:minimize` / `win:toggleMaximize` / `win:isMaximized` / `win:setMaterial` | - / material | - / boolean |

## 数据层

| 通道 | 入参 | 返回 |
|---|---|---|
| `store:load` | - | 全量 tools.json |
| `store:save` | data | - |
| `settings:sync` | partial settings | - （热更新：logstore.configure 等） |
| `config:export` / `config:import` | - / json | 文件对话框 |
| `preset:import` | json | - |

## workspace（工作空间域）

| 通道 | 入参 | 返回 |
|---|---|---|
| `workspace:list` | - | workspaces[] |
| `workspace:create` / `workspace:update` | payload / `{ id, patch }` | 实体 / `{ ok }` |
| `workspace:delete` | id | `{ ok }` |
| `workspace:touch` | id | - （更新 lastUsedAt） |
| `workspace:removeToolRef` | `{ workspaceId, toolId }` | `{ ok }` |

## launcher（启动域）

| 通道 | 入参 | 返回 |
|---|---|---|
| `launcher:resolve` | `{ toolId, configId? }` | 解析后的有效启动参数（回落规则见 launcher.js） |
| `launcher:run` | `{ toolId, configId?, skipHealth? }`（**v2.1** 加 skipHealth） | `{ ok, pid? , blocked?, results?, warnings? }`；`blocked=true` 表示健康检查拦截，`results` 为逐项检查结果，`warnings` 为 blockOnFail=false 时的失败摘要 |

**beforeLaunch 语义（v2.1）**：工具挂了 `checkIds` → 跑检查（走 TTL 缓存）；有红项且 `blockOnFail=true` → 拦截（渲染层可传 `skipHealth: true` 强制覆盖）；`blockOnFail=false` → 放行但附 `warnings`。

## runner（进程域）

| 通道 | 入参 | 返回 |
|---|---|---|
| `runner:run` | 启动参数 | `{ ok, pid }` |
| `runner:list` | - | 运行中进程[]（含 cpu/ram） |
| `runner:kill` / `runner:killByTool` | pid / toolId | - |
| `runner:logs` / `runner:clearLogs` | toolId | 内存日志 / - |

## log（日志中心域，v2.1）

| 通道 | 入参 | 返回 |
|---|---|---|
| `log:list` | - | 工具日志元信息[]（行数/错误数/警告数/大小/ago） |
| `log:read` | toolId, tail? | 尾部行[]（上限 10000） |
| `log:clear` | toolId | `{ ok }` |
| `log:export` | toolId | `{ ok, path }`（敏感提示在渲染层 confirmBox） |
| `log:openDir` | - | 打开 logs 目录 |

落盘为 jsonl（见 docs/data-model.md），等级经 errorPatterns/warnPatterns 重判；5MB 轮转保留一代，14 天（可配）过期清理。

## command（命令库域，v2.1）

| 通道 | 入参 | 返回 |
|---|---|---|
| `command:list` | - | commands[] |
| `command:create` | `{ name, emoji?, desc?, template, tags? }` | cmd 实体 |
| `command:update` | `{ id, patch }` | `{ ok, command }`（可写 name/emoji/desc/template/tags/favorite/varMemory/runCount/lastRunAt） |
| `command:delete` | id | `{ ok }` |
| `command:run` | `{ id, name, rendered, cwd?, confirmedDanger? }` | `{ ok, pid }` 或 `{ ok:false, error:'danger-blocked' }` |

变量渲染（workspace > globalVars > ask）与危险确认 UI 在渲染层；主进程对 `rendered` 兜底扫 `dangerPatterns`，命中且未确认即拒。运行 = 隐藏 `cmd /c`，输出进日志中心。

## health（环境健康检查域，v2.1）

| 通道 | 入参 | 返回 |
|---|---|---|
| `health:run` | `{ checkIds?, force? }` | 结果[] `{ checkId, name, type, ok, message, fixTip, durationMs, cached }` |
| `health:checks` | - | checks[] |
| `health:create` | 模板字段 | chk 实体 |
| `health:update` | `{ id, patch }` | `{ ok, check }`（自动失效缓存） |
| `health:delete` | id | `{ ok }`（联动清理工具 checkIds + 失效缓存） |

三类检测语义与缓存见 docs/data-model.md。

## resource（资源中心域，v2.1）

| 通道 | 入参 | 返回 |
|---|---|---|
| `resource:preview` | path | `{ ok, ext?, size?, lines?, truncated?, totalLines? }` 或 `{ ok:false, reason: 'not-text'\|'missing'\|'not-file'\|'too-large'\|'error', message }` |
| `resource:open` | path | `{ ok }` 或 `{ ok:false, message }` |

## 杂项

| 通道 | 说明 |
|---|---|
| `dialog:pickTool` / `dialog:pickDir` / `dialog:pickImage` / `dialog:saveLogs` | 文件/目录选择与另存 |
| `fs:exists` / `fs:pathInfo` | 路径存在性与类型/扩展名 |
| `shell:showInFolder` | 资源管理器定位 |
| `clipboard:write` | 写剪贴板 |
| `icon:get` / `icon:remove` | 工具图标提取/清除 |
| `secret:available` / `secret:encrypt` / `secret:decrypt` | 凭据安全存储 |
| `logger:open` | 打开应用日志 |

## 推送事件（webContents.send → preload onX 注册）

| 事件 | 载荷 | 说明 |
|---|---|---|
| `runner:log` | `{ toolId, time, text, level }` | 进程输出实时推送（v2.1 起等级经 logstore 重判后推送） |
| `runner:exit` / `runner:list` | pid/进程列表 | 进程退出与指标轮播（3s） |
