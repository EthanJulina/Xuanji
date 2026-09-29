# 玄机数据模型 v2.1

> 配置文件: `%APPDATA%/QuickDock/tools.json`（单文件存储，写前防抖合并，迁移前滚动备份）
> 本文档对应 P1 轮（Task #14~#18）落地后的完整 schema。

## 顶层结构

```jsonc
{
  "version": "2.1",
  "categories": [ /* ... */ ],
  "tools":      [ /* 工具实体,见下 */ ],
  "workspaces": [ /* ... */ ],
  "commands":   [ /* v2.1 命令库,见下 */ ],
  "resources":  [ /* v2.1 资源中心,见下 */ ],
  "checks":     [ /* v2.1 健康检查模板,见下 */ ],
  "settings":   { /* 见下 */ }
}
```

## 工具实体 `tools[]`（v2.1 新增字段加粗）

| 字段 | 类型 | 说明 |
|---|---|---|
| id / name / path / emoji / desc | - | 基础信息（P0 已有） |
| categoryId / tags / favorite | - | 分类与标签（P0 已有） |
| launchConfigs[] / activeLaunchConfigId | - | 启动配置组（P0 已有） |
| runMode / runAsAdmin / showWindow | - | 旧字段，作为配置缺省时的回落值 |
| **checkIds[]** | string[] | 挂载的健康检查模板 id；启动时经 `launcher.beforeLaunch` 拦截 |

## 健康检查模板 `checks[]`（v2.1 新增实体）

```jsonc
{
  "id": "chk-xxxxxxxx",        // 随机 8 位
  "name": "Java 版本",
  "type": "exec",              // exec | port | file
  "command": "java -version 2>&1",  // exec 专用
  "expectRegex": "version",    // exec 专用;命中输出(i 忽略大小写)即通过,空则看退出码
  "timeoutMs": 8000,           // exec 专用,钳制 1s~30s
  "host": "127.0.0.1",         // port 专用
  "port": 8080,                // port 专用
  "path": "D:\\tools\\x.exe",  // file 专用,存在即通过
  "fixTip": "未检测到 Java:..." // 失败时的修复建议(面板展示)
}
```

- **检测语义**：exec = `cmd /c <command>` 后 `expectRegex`（i）匹配合并输出，超时上限 30s；port = TCP 连通（3s 超时），连上即过；file = `existsSync`。
- **缓存**：主进程内存 `checkId → { ok, message, at }`，TTL = `settings.healthCheck.cacheTtlSec`；`health:update` / `health:delete` 自动失效。
- **预设种子**：v2.0→v2.1 迁移时若 `checks` 为空，写入 4 条内置模板（chk-java / chk-python / chk-pip / chk-git，见 `electron/migrate/v2-0-to-v2-1.js` 的 `HEALTH_PRESETS`），不覆盖用户已有数据。
- **引用完整性**：删除模板时联动从所有工具的 `checkIds` 移除。

## 命令库 `commands[]`（v2.1 新增实体）

```jsonc
{
  "id": "cmd-xxxxxxxx",
  "name": "nmap 快扫",
  "emoji": "⌨️",
  "desc": "说明",
  "template": "nmap -sV {{target}} -p {{ports}}",  // {{key}} 变量占位
  "tags": ["recon"],
  "favorite": false,
  "varMemory": { "target": "10.0.0.1" },  // ask 变量记忆:key → 上次填写值
  "runCount": 3,
  "lastRunAt": "2026-02-10T09:00:00",
  "createdAt": "2026-02-10T08:00:00"
}
```

**变量渲染优先级**：`workspace vars` > `globalVars(settings 顶层)` > `ask 表单`（`src/stores/commandStore.js`）。渲染在渲染层完成；主进程运行前对渲染结果做 `dangerPatterns` 兜底扫描，命中且未经确认（`confirmedDanger`）即拒绝（`danger-blocked`）。运行 = 隐藏 `cmd /c`，输出进日志中心全链路。

## 资源中心 `resources[]`（v2.1 新增实体，引用式）

```jsonc
{
  "id": "res-xxxxxxxx",
  "name": "字典",
  "path": "D:\\dicts\\common.txt",  // 仅引用,删除记录不动文件
  "tags": ["dict"],
  "desc": "常用目录字典",
  "favorite": false,
  "createdAt": "2026-02-10T08:00:00"
}
```

预览仅支持白名单扩展名（20 种：txt/md/json/log/js/ts/py/ps1/bat/cmd/conf/cfg/ini/yaml/yml/xml/html/css/sql/sh），≤1MB，前 200 行（`truncated` 标记）；路径不存在 = 悬空引用（列表标红 + 预览 `reason: 'missing'`）。

## settings（v2.1 新增三域）

```jsonc
"settings": {
  "theme": "dark", "closeToTray": true, "sortMode": "manual",  // P0 已有
  "run": {                              // v2.1 命令运行
    "defaultCwd": "",                   // 命令默认工作目录
    "dangerPatterns": [ "rm\\s+...", "\\bformat\\b", "\\bdel\\b", "\\bshutdown\\b", "reg\\s+delete" ]
  },
  "log": {                              // v2.1 日志中心
    "errorPatterns": ["\\berror\\b", "\\bfatal\\b", "exception", "traceback", "失败", "错误"],
    "warnPatterns":  ["\\bwarn", "warning", "警告", "deprecated"],
    "retentionDays": 14,                // 过期清理阈值
    "maxFileSizeMB": 5                  // 单文件轮转阈值
  },
  "healthCheck": {                      // v2.1 健康检查
    "cacheTtlSec": 300,
    "blockOnFail": true                 // 启动拦截开关(红项默认阻止,可 skipHealth 覆盖)
  }
}
```

## 日志落盘（文件系统，不入 tools.json）

```
%APPDATA%/QuickDock/logs/
  <toolId>.jsonl       当前文件,行格式 { "t": ISO时间, "lvl": "info|success|warn|error", "text": "..." }
  <toolId>.1.jsonl     轮转保留一代(超 maxFileSizeMB 时 rename)
  meta.json            工具日志元信息(行数/错误数/大小,启动扫描+轮转后精确重算)
```

- **等级重判**：显式 error/warning/success 保留；info 级按 `errorPatterns`（优先）→ `warnPatterns` 用正则重判；非法正则忽略。
- **清理**：启动后 10s 首巡 + 每 6h 定时，删除 mtime 超过 `retentionDays` 的文件。

## 迁移链

```
v1.x --v1-to-v2--> v2.0 --v2-0-to-v2-1--> v2.1
                     (两级串行,main.js 启动时执行)
```

- 迁移前滚动备份：`tools.json` → `bak.1` → `bak.2` → `bak.3`（三代轮换，`electron/modules/backup.js`）。
- 迁移静默完成；主进程置 `global.__qdJustMigratedVersion = '2.1'`，渲染层经 `app:info` 读取后 toast「配置已升级到 v2.1」。
- `ensureV21` 幂等：已是 v2.1 的数据走字段兜底（缺什么补什么），保证老配置读出即完整形态。
