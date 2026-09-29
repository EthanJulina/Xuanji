# 玄机

> 原名「工具坞 QuickDock」,v1.3.0 起正式更名为**玄机**,v2.0.0 起升级为**个人安全操作台**(更新历史见 [updatelogs/CHANGELOG.md](updatelogs/CHANGELOG.md))。

纯本地运行的 Windows 桌面**网络安全人员个人安全操作台** —— 面向渗透测试 / 红队 / DevSecOps 工作流:
集中管理 `.bat` / `.cmd` / `.lnk` / `.exe`,以**工作空间**组织一次任务的全部上下文(工具引用 / 项目目录 / 目标变量),
每个工具支持**多套启动配置**,首页工作台一键回到现场,Ctrl+K 命令面板全类型直达。
深色毛玻璃 + 无边框窗口 + macOS / GNOME 质感动效,跑在 Win11 上也没有"Win32 老软件味"。

**不联网、不上传数据、无任何数据库** —— 所有配置就是一个本地 JSON 文件。

## 功能一览

| 模块 | 说明 |
|---|---|
| **首页工作台** | 启动默认进入:问候语 + 今日启动统计、🎯 最近的工作空间(一键回到现场)、最近使用、快速操作;默认页可在设置中改为「全部工具」或「上次视图」 |
| **工作空间** | 一次渗透任务的全部上下文:工具**引用**(非复制,删除工具自动清理引用)、项目目录(资源管理器一键直达)、目标变量;「启动环境」为显式动作 —— 勾选后按序串行拉起(间隔 0.5s),二次确认 / 管理员权限照常生效,**进入空间绝不自动启动任何工具** |
| **多启动配置** | 每个工具多套启动配置(名称 / args / cwd / env / 管理员 / 运行方式),任设默认;卡片单击 = 默认配置,「⋯」菜单可选其他配置;字段留空自动回落工具基础设置(兼容 v1) |
| **命令面板** | `Ctrl+K` 分组搜索:工具(名称/备注/分类/拼音首字母)/ 工作空间 / 命令 / 资源路径,命中片段高亮,↑↓+Enter 直达;悬停工具条目可一键固定到 Dock |
| **Dock** | macOS 式底部 Dock,三档模式(设置页切换,默认**自动隐藏**:鼠标压窗口底边滑出,离开 0.4s 收回):内容 = 已固定工具(上限 10,可拖拽排序)+ 运行中未固定工具;hover 放大 + 相邻距离衰减 + tooltip(名称/状态),运行中带呼吸圆点;右键 打开 / 以配置运行 / 结束进程 / 移除 |
| **全局呼出** | `Ctrl+Space` 系统级快捷键:任意界面一键呼出/隐藏窗口并聚焦命令面板(最小化到托盘时同样生效) |
| **工具组合** | 一键工作环境(与工作空间并存):多工具打包成组合,侧边栏一点全部按序拉起(间隔 0.4s) |
| **命令库** | 命令模板 + `{{变量}}`:渲染优先级 工作空间变量 > 全局变量 > 运行时询问(带记忆);运行弹窗实时预览,危险命令强制确认(渲染层 + 主进程双保险);隐藏 `cmd /c` 运行,输出进日志中心;Ctrl+K Enter 运行 / Shift+Enter 复制 |
| **资源中心** | Payload/字典/脚本引用式管理(删记录不动文件),列表/网格视图 + 标签/收藏/搜索,悬空引用标红,文本白名单预览(200 行截断),Ctrl+K 直达打开 |
| **日志中心** | 工具输出 jsonl 落盘,按判定正则重判等级;独立视图:工具列表 + 四维过滤(等级/时间/关键字)+ 虚拟滚动万行流畅;5MB 轮转 + 14 天过期清理(可配);导出前敏感提示 |
| **环境健康检查** | exec/port/file 三类检测模板(TTL 缓存);设置页管理,工具弹窗挂载;启动前自动检查,红项默认阻止启动(面板逐项展示 + 修复建议 + 强制启动覆盖) |
| 无边框窗口 | 自定义标题栏 + macOS 红绿灯,Win11 下启用 Mica/Acrylic 材质,CSS 毛玻璃降级 |
| 启动模式 | 四档运行方式:**正常窗口 / 隐藏窗口 / 日志模式(自动开面板)/ 后台服务(独立常驻)**;拖拽文件进窗口自动识别预填 |
| 分类体系 | 固定「首页 / 全部工具 / ⭐ 常用 / 🕘 最近使用 / 未分类」+ 自定义分类(emoji + 颜色 + 角标 + 拖拽排序)+ 工作空间分区 + 规划中占位 |
| 运行逻辑 | bat/cmd/exe 按启动模式运行;lnk 交系统 ShellExecute;**管理员运行统一 ShellExecute `runas`(UAC 确认)**;运行前自动健康检查,目标文件丢失时引导定位 |
| 日志系统 | 等级化输出(INFO / SUCCESS / WARN / ERROR);自动识别异常(Java 未找到、端口占用等)并给修复建议;一键 复制 / 保存 / 清空 |
| 进程指标 | 运行中显示名称与时长,悬浮查看 PID / CPU / 内存;脉冲标记、手动结束、退出时询问是否终止子进程 |
| 使用报告 | 设置页:今日启动 / 本周活跃 / 近 7 天 Top 5;沉睡工具清点;工具健康检查 |
| 图标 | `app.getFileIcon` 自动获取系统真实图标并缓存;支持 emoji / 本地图片 / 首字母占位 |
| P2 占位 | 侧边栏「规划中」:代理管理 / 测试记录 —— 点开为「开发中」引导页;P1 四模块(命令库/资源/日志/健康检查)已于 v2.2.0 落地 |
| 其他 | 托盘最小化、底部 Dock、日志面板、导出/导入配置(导出前敏感数据提示)、深/浅/跟随系统主题 |

## 安全说明(安全从业者必读)

- **零网络**:全代码无 fetch / XHR / WebSocket,唯一 URL 是开发模式的本地 Vite 服务器;杀软若报"网络行为"属误报
- **杀软误报**:玄机以 Electron 打包、会 spawn 子进程(bat/exe)并支持 UAC 提权启动,这类行为(尤其便携版/未签名版)可能被杀软启发式标记,**属误报**;可加入白名单或自行从源码构建。应用本身无任何混淆、无网络上报、无持久化钩子
- **敏感数据**:配置里可能存有内网地址 / 目标信息;导出配置前会弹敏感数据提示。主进程内置 safeStorage(DPAPI)加解密能力(`{ encrypted: true, value: "<base64>" }`),供 P1 secret 变量 / P2 Proxy 凭据接入后加密落盘 —— DPAPI 密钥绑定当前用户,**导出文件在别的机器上无法解密(预期安全行为)**
- **管理员运行**:走 ShellExecute `runas` + UAC 确认,不使用任何 cmd 提权 hack

## 环境要求

- Node.js ≥ 18(开发用的是 22)
- npm(建议已配置国内镜像)
- Windows 10/11(Win11 可获得系统级 Mica/Acrylic 毛玻璃)

## 安装与运行

```bash
# 1. 安装依赖(国内镜像推荐)
npm config set registry https://registry.npmmirror.com
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   # PowerShell: $env:ELECTRON_MIRROR="..."
npm install

# 2a. 一键开发模式(Vite + Electron 热更新)
npm run dev:electron

# 2b. 或分步:终端 A 起 Vite,终端 B 起 Electron
npm run dev
npm run start        # 生产模式加载 dist(需先 build)

# 3. 构建渲染层
npm run build

# 4. 打包安装程序(NSIS)+ 便携版
npm run pack
# 仅便携版:
npm run pack:portable
```

## 数据存储

- 配置文件:`%APPDATA%\玄机\tools.json`(原子写入:先写临时文件再重命名);settings 内含 `dock: { mode, pinnedToolIds, iconSize }`(Dock 三档模式与固定列表,与工具星标置顶相互独立)
- **v1→v2 自动迁移**:v2.0 首次启动自动把旧配置升级为 v2.0 结构 —— 原文件原样备份为 `tools.json.bak`,旧工具自动生成「默认启动」配置(完整继承原 runMode / 管理员 / 日志捕获行为),缺字段自动兜底;迁移完成后弹 toast 告知,确认无异常后可自行删除 `.bak`
- 图标缓存:`%APPDATA%\玄机\icons\{toolId}.png`
- 应用日志:`%APPDATA%\玄机\app.log` —— **追加写入 + 按大小轮转**:每次启动追加「新的一次启动」横幅;单份达 5MB 自动轮转为 `app.1.log → … → app.5.log`(编号越大越旧),保留最近 5 份历史 + 当前 1 份,最坏占用约 30MB;疑似凭据写入前自动脱敏;设置页可一键打开
- **从 v1.2 及更早升级**:v1.3.0 更名后首次启动,自动把旧目录 `%APPDATA%\工具坞 QuickDock` 的配置、图标缓存与历史日志迁移到新目录
- 设置页可一键打开数据目录、导出/导入 JSON 配置(导出前有敏感数据提示)

## 批量导入工具

编辑 `scripts/seed-tools.py` 里的 `CATEGORIES` 与 `TOOLS` 清单后执行:

```bash
python scripts/seed-tools.py
```

脚本幂等(按目标路径去重),重复执行不会产生重复条目,也不会覆盖你手动添加的工具。

## 目录结构

```
QuickDock/                  # 物理目录名保留(工程路径),应用显示名为「玄机」
├── package.json              # 脚本与 electron-builder 配置
├── vite.config.js            # Vite 配置(渲染层构建)
├── index.html                # 入口 HTML(含 CSP)
├── build/icon.png            # 应用/托盘图标
├── updatelogs/               # 更新日志(CHANGELOG.md,按版本倒序)
├── docs/
│   └── future-database.md    # P2 数据库设计预案(本期仍是纯本地 JSON)
├── electron/                 # ---- 主进程 ----
│   ├── main.js               # 窗口(frame:false + backgroundMaterial)、IPC 路由、托盘、v1→v2 迁移触发
│   ├── preload.js            # contextBridge 暴露 window.qd 安全接口(workspace:/launcher:/secret: 域)
│   ├── store.js              # 数据层:tools.json v2.0 原子读写 + 字段兜底
│   ├── migrate/
│   │   └── v1-to-v2.js       # v1→v2 迁移:.bak 备份 / 默认 launchConfig 生成 / v2 骨架
│   ├── modules/              # 主进程领域模块
│   │   ├── workspace.js      # 工作空间 CRUD / 引用清理 / touch
│   │   ├── launcher.js       # 运行时解析:active 配置优先,字段空回落工具顶层旧字段
│   │   └── secret.js         # safeStorage(DPAPI)加解密域(P1/P2 接入预留)
│   ├── runner.js             # 进程层:4 类目标启动/追踪/日志/结束;管理员 ShellExecute runas
│   ├── logger.js             # 应用日志:追加写入 + 5MB 轮转,保留最近 5 份(app.1~5.log)+ 凭据脱敏
│   ├── icons.js              # app.getFileIcon 图标缓存
│   └── main-bridge.js        # 主进程窗口桥(事件推送)
├── src/                      # ---- 渲染层(Vue 3)----
│   ├── main.js               # 入口
│   ├── App.vue               # 根组件(布局组装)
│   ├── styles/
│   │   ├── tokens.css        # 设计令牌(圆角/主色/背景/文本三级/动效曲线/阴影)
│   │   └── global.css        # reset/滚动条/焦点环/统一过渡动画
│   ├── composables/store.js  # 全局状态:数据 CRUD/视图/toast/确认框/右键菜单/运行链路
│   ├── stores/               # v2 领域 store(独立实体独立 store)
│   │   ├── workspaceStore.js # 工作空间:CRUD/勾选态/启动环境(串行 0.5s)
│   │   ├── dockStore.js      # Dock:三档模式/固定管理(上限10)/运行区合成/互斥
│   │   ├── launchConfigStore.js # 启动配置辅助
│   │   └── searchIndexStore.js  # Ctrl+K 搜索索引(工具/工作空间/命令/资源)
│   ├── utils/
│   │   ├── pinyin.js         # 拼音首字母匹配(pinyin-pro,纯本地)
│   │   └── highlight.js      # 命中片段高亮
│   └── components/
│       ├── TitleBar.vue      # 自定义标题栏 + 红绿灯 / 运行中提示
│       ├── Sidebar.vue       # 导航:首页/全部工具/常用/最近 + 工作空间分区 + 分类 + 规划中占位
│       ├── MainArea.vue      # 视图路由:home / all / workspace / dev / 分类 / 组合
│       ├── HomeView.vue      # 首页工作台:问候/最近工作空间/最近使用/快速操作
│       ├── WorkspaceView.vue # 工作空间详情:工具勾选/启动环境/项目目录/变量
│       ├── WorkspaceModal.vue# 工作空间新建/编辑
│       ├── WorkspaceAddTools.vue # 添加工具到工作空间(多选)
│       ├── DevPlaceholder.vue# P1/P2「开发中」引导页
│       ├── ToolCard.vue      # 工具卡片(⋯菜单:多配置运行/添加到工作空间)
│       ├── ToolIcon.vue      # 图标渲染(系统图标/emoji/图片/首字母)
│       ├── CommandPalette.vue# Ctrl+K 命令面板(分组搜索 + 高亮)
│       ├── ToolModal.vue     # 添加/编辑弹窗(基础信息 + 启动配置双标签)
│       ├── LaunchConfigTab.vue # 多启动配置编辑器(新建/复制/删除/设为默认)
│       ├── KvEditor.vue      # 键值对编辑器(env / 变量)
│       ├── ComboModal.vue    # 工具组合创建/编辑
│       ├── CategoryModal.vue # 分类管理
│       ├── DeleteModal.vue   # 删除确认
│       ├── ConfirmModal.vue  # 通用确认框(Promise)
│       ├── LogPanel.vue      # 运行日志抽屉
│       ├── SettingsView.vue  # 设置页(含默认视图/导出敏感提示)
│       ├── Dock.vue / ToastStack.vue / ContextMenuHost.vue / CustomSelect.vue / EmojiPicker.vue
│       └── ...               # 其余同 v1
└── scripts/                  # 辅助脚本
    ├── gen-icon.py           # 图标生成脚本
    ├── seed-tools.py         # 批量导入工具(幂等)
    ├── test-migrate.js       # v1→v2 迁移单元测试(29 用例)
    ├── test-logger.js        # 日志轮转单元测试
    ├── find-tools.py / screenshot.py
```

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl + Space` | **全局呼出**:任何界面一键呼出/隐藏窗口并聚焦命令面板(系统级注册,托盘状态也生效) |
| `Ctrl + K` | 命令面板(搜索 / 运行 / 编辑) |
| `Ctrl + F` | 聚焦搜索框 |
| `Enter` / `Ctrl + Enter` | 面板内:运行 / 编辑 |
| 双击标题栏 | 最大化 / 还原 |

## 路线图

- **P1(数据结构已预留)**:命令模板(变量渲染)/ Payload·资源库 / 日志中心 / 环境健康检查常驻 / 代理管理 Profils / 测试记录 Sessions
- **P2**:数据库升级预案见 [docs/future-database.md](docs/future-database.md);Proxy 凭据 safeStorage 加密接入
- 已砍除:插件系统;不做 VPN 检测

## 故障排查

| 现象 | 处理 |
|---|---|
| 启动即崩,日志出现 `GPU process isn't usable` | GPU 驱动异常,用 `set QD_DISABLE_GPU=1 && npm run start` 以软渲染兜底 |
| 开发时 `electron` 被当成纯 Node 运行(报 `app` undefined) | 终端残留了 `ELECTRON_RUN_AS_NODE=1`,启动前执行 `set ELECTRON_RUN_AS_NODE=` 清掉 |
| `rollup` / `esbuild` 报 MODULE_NOT_FOUND | 平台二进制缺失:`npm i @rollup/rollup-win32-x64-msvc @esbuild/win32-x64 --save-optional` |
| 国内下载 Electron 慢 | `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |

## 自检脚本(开发者)

```bash
# 基础 smoke:启动 3 秒自动退出,结果写 smoke-result.txt
set QD_SMOKE=1 && npx electron .

# 深度 smoke:真实运行 bat(中文+空格路径)/ exe / 不存在路径,验证日志与进程管理
set QD_SMOKE=1 && set QD_SMOKE_RUN=1 && npx electron .

# 日志轮转单元测试(不依赖 Electron,纯 Node)
node scripts/test-logger.js

# v1→v2 迁移单元测试(不依赖 Electron,纯 Node)
node scripts/test-migrate.js
```

## 技术说明

- Electron 31 + Vue 3 + Vite,无组件库、无动画库、无数据库、零网络请求
- 主进程按领域拆分 `electron/modules/`(workspace / launcher / secret),渲染层全局 store(`composables/store.js`)+ 领域 store(`stores/*.js`)
- **IPC 传输约定**:Vue reactive Proxy 无法通过 Electron 结构化克隆,凡是把 store 内对象传给 `window.qd.*` 的调用点,必须 `JSON.parse(JSON.stringify(...))` 深拷贝后传递——**浅拷贝/展开不够**:settings 含嵌套对象(dock 等),浅拷贝会残留嵌套 Proxy 引用(已在 `syncSettings` / `wsUpdate` 等入口统一处理,新增 IPC 时务必遵守)
- 设计令牌集中在 `src/styles/tokens.css`(CSS 变量),浅色主题通过 `data-theme` 切换
- 原子写入、路径中文/空格均已处理(启动参数经引号转义,数据读写 UTF-8)
