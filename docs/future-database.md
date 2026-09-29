# 数据库演进方案(future-database.md)

> 本文档为 P2 规划交付物,**仅设计,不实现**。当前版本所有数据存储于单一 `tools.json`(原子写入),完全满足个人单机场景。

## 一、迁移触发时机(什么时候需要 SQLite)

满足以下**任一**条件时启动迁移评估:

| # | 触发条件 | 当前 JSON 的痛点 |
|---|---------|-----------------|
| 1 | `sessions` 累计事件超过 **5 万条** | 全量读写 JSON 开始出现可感知延迟(>200ms) |
| 2 | 单个工具日志需要**跨会话持久化**(当前日志仅内存,重启即失) | JSON 不适合追加型大文本 |
| 3 | 命令模板/资源引用超过 **2000 条**且需要**全文检索**(FTS5) | 内存索引构建时间与内存占用线性增长 |
| 4 | 未来引入多「项目档案」并行统计报表 | 聚合查询在 JSON 上需要手写全量扫描 |

> 经验值:安全人员日常单机使用,工具 <200、命令模板 <100、session 事件每天 <500 条。**JSON 方案预计可健康服务 2~3 年**。不到触发条件不迁移,避免过度设计。

## 二、目标表设计(SQLite WAL 模式)

```sql
-- 主档:工具与启动配置(1 : N 拆表,JSON 中嵌套的 launchConfigs 独立成行)
CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- exe / bat / cmd / lnk
  target_path TEXT NOT NULL,
  category_id TEXT,
  icon TEXT,                        -- 保留 JSON 串(auto/emoji/img 三态)
  pinned INTEGER DEFAULT 0,
  run_mode TEXT DEFAULT 'window',   -- 顶层旧字段(回落兜底)
  run_as_admin INTEGER DEFAULT 0,
  confirm_before_run INTEGER DEFAULT 0,
  run_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  sort_order INTEGER,
  active_launch_config_id TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE launch_configs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  args TEXT DEFAULT '',
  cwd TEXT DEFAULT '',
  env TEXT DEFAULT '{}',            -- JSON 串;secret 值存 secret_boxes 引用
  run_mode TEXT,
  run_as_admin INTEGER,
  is_active INTEGER DEFAULT 0
);

-- 工作空间(引用关系单独成表,替代 toolIds 数组 → 天然支持排序)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, emoji TEXT, color TEXT,
  last_opened_at TEXT, sort_order INTEGER
);
CREATE TABLE workspace_tools (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  sort_order INTEGER,
  PRIMARY KEY (workspace_id, tool_id)
);
CREATE TABLE workspace_paths (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT, path TEXT NOT NULL, sort_order INTEGER
);
CREATE TABLE workspace_vars (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,              -- secret 变量改为指向 secret_boxes
  PRIMARY KEY (workspace_id, key)
);

-- P1:命令库 / 资源引用
CREATE TABLE commands (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, desc TEXT,
  template TEXT NOT NULL, tags TEXT, var_memory TEXT,  -- JSON 串
  created_at TEXT, updated_at TEXT
);
CREATE TABLE resources (
  id TEXT PRIMARY KEY, type TEXT, name TEXT, path TEXT,
  tags TEXT, fav INTEGER DEFAULT 0, last_opened_at TEXT
);

-- P2:会话事件流(最大量表,必须独立成表)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, notes TEXT
);
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,               -- tool_run / command / note / proxy_switch
  ref_id TEXT, detail TEXT, status TEXT
);
CREATE INDEX idx_events_session ON session_events(session_id, ts);

-- P2:代理(凭据加密后存密文)
CREATE TABLE proxy_profiles (
  id TEXT PRIMARY KEY, name TEXT, type TEXT,
  host TEXT, port INTEGER,
  auth_box TEXT                     -- safeStorage 密文(JSON 串 {encrypted, value})
);

-- 敏感字段密文盒(独立表便于轮换与审计)
CREATE TABLE secret_boxes (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL               -- safeStorage(DPAPI) 密文 base64
);

-- 运行日志(触发条件 2 落地时启用)
CREATE TABLE run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT, ts TEXT NOT NULL,
  level TEXT, message TEXT
);
CREATE INDEX idx_logs_tool ON run_logs(tool_id, ts);
```

## 三、迁移策略(一次性、可回退)

1. **双写期**:v3.x 启动检测 `tools.json` 存在 → 全量导入 SQLite → 保留 `tools.json` 为只读镜像(一个版本周期);
2. **导入校验**:逐表对比行数 + 关键字段抽样(工具数/配置数/工作空间引用数),不一致则中止并报错,用户数据零风险;
3. **切换**:校验通过后写入 `migration.done` 标记,SQLite 成为唯一事实源;
4. **回退**:删除 `migration.done` 即回到 JSON 模式(双写期保证两份数据都新鲜);
5. **DPAPI 密文**:加密数据**不迁移明文**,导出时提示「加密字段需在新环境重新录入」。

## 四、不迁移的部分

- `settings`(键值对,量小):维持 JSON(`settings.json` 独立拆出);
- 图标缓存:继续使用文件系统(`icons/{toolId}.png`);
- 应用日志 `app.log`:继续追加 + 轮转(与业务数据生命周期不同)。

## 五、性能预算(迁移后验收标准)

| 操作 | JSON 现状 | SQLite 目标 |
|-----|---------|------------|
| 启动加载(5 万事件) | ~800ms 全量解析 | <50ms(懒加载首页) |
| session 事件写入 | 全量重写 ~2MB | 单行 INSERT <1ms |
| Ctrl+K 全文搜索(2000 命令) | 内存索引 ~120ms 构建 | FTS5 <10ms(仍可内存缓存) |
