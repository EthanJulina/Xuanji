<script setup>
// 主内容区:顶栏(视图名/搜索/排序/添加)+ 视图路由 + 分组卡片网格 + 空状态
// v2.0 视图路由:home(首页)/ workspace(工作空间)/ dev(P1/P2 占位)
//               其余沿用:all/star/recent/combo/cat/uncat/settings
import { computed, ref } from 'vue'
import {
  s, setView, viewGroups, visibleCount, viewTitle, totalCount, toggleCollapse,
  persist, toast, greeting, continueTools, todayRunCount, runCombo, comboById,
  askRun, doRun, computePredictions
} from '../composables/store'
import SettingsView from './SettingsView.vue'
import HomeView from './HomeView.vue'
import WorkspaceView from './WorkspaceView.vue'
import LogCenterView from './LogCenterView.vue'
import CommandVaultView from './CommandVaultView.vue'
import ResourceCenterView from './ResourceCenterView.vue'
import DevPlaceholder from './DevPlaceholder.vue'
import ToolCard from './ToolCard.vue'
import ToolIcon from './ToolIcon.vue'

const SORTS = [
  { value: 'manual', label: '手动' },
  { value: 'name', label: '按名称' },
  { value: 'frequent', label: '按常用' }
]

const searchRef = ref(null)

// 首页 / 工作空间 / 占位页 / 设置 / 日志中心 / 命令库 / 资源中心:整页视图
const FULLSCREEN_VIEWS = ['home', 'workspace', 'dev', 'settings', 'logcenter', 'commandvault', 'resourcecenter']
const isFullscreen = computed(() => FULLSCREEN_VIEWS.includes(s.view.type))

// 折叠状态判断(全部工具视图下)
function isCollapsed(groupId) {
  return s.collapsed.has(groupId)
}

const isEmptyAll = computed(() => !isFullscreen.value && s.view.type !== 'settings' && totalCount.value === 0)
const isSearchEmpty = computed(() => s.search.trim() && visibleCount.value === 0)

// Ctrl+F 聚焦搜索
function onGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !isFullscreen.value) {
    e.preventDefault()
    searchRef.value?.focus()
  }
}
window.addEventListener('keydown', onGlobalKey)

// 一键导入预设工具包(主进程内置骨架,按目标路径去重)
const qd = window.qd
async function importPreset() {
  const r = await qd.importPreset()
  if (r.added > 0) toast(`已导入 ${r.added} 个预设工具`, 'success')
  else toast('预设工具已在库中,或本机缺少对应程序', 'info')
}

/* ---- 组合视图:一键启动 ---- */
function runCurrentCombo() {
  const combo = comboById(s.view.id)
  if (combo) runCombo(combo)
}

/* ---- 智能首页(recent 视图) ---- */
// 预测条点击启动,启动后立即重算(启动过今天就不打扰了)
async function predictRun(tool) {
  await doRun(tool)
  computePredictions()
}
</script>

<template>
  <main class="main-area">
    <!-- ===== 整页视图:首页 / 工作空间 / P1P2 占位 / 设置 ===== -->
    <HomeView v-if="s.view.type === 'home'" />
    <WorkspaceView v-else-if="s.view.type === 'workspace'" />
    <LogCenterView v-else-if="s.view.type === 'logcenter'" />
    <CommandVaultView v-else-if="s.view.type === 'commandvault'" />
    <ResourceCenterView v-else-if="s.view.type === 'resourcecenter'" />
    <DevPlaceholder v-else-if="s.view.type === 'dev'" :id="s.view.id || 'commands'" />
    <SettingsView v-else-if="s.view.type === 'settings'" />

    <!-- ===== 列表视图(顶栏 + 分组网格)===== -->
    <template v-else>
      <!-- 顶栏 -->
      <div class="topbar">
        <div class="view-info">
          <h2 class="view-title">{{ viewTitle }}</h2>
          <span class="view-count">{{ visibleCount }} 个工具</span>
        </div>

        <!-- 搜索框:实时过滤当前视图 -->
        <div class="search-wrap">
          <span class="search-ico">🔍</span>
          <input ref="searchRef" v-model="s.search" class="search-input"
                 placeholder="搜索工具(名称 / 备注 / 拼音首字母)" />
          <button v-if="s.search" class="clear-btn" @click="s.search = ''">✕</button>
        </div>

        <!-- 排序切换 -->
        <div class="seg">
          <button v-for="opt in SORTS" :key="opt.value"
                  class="seg-item" :class="{ on: s.data.settings.sortMode === opt.value }"
                  @click="s.data.settings.sortMode = opt.value; persist()">
            {{ opt.label }}
          </button>
        </div>

        <button class="btn btn-primary add-btn" @click="s.toolModal.open = true; s.toolModal.editId = null">
          ＋ 添加
        </button>

        <!-- 组合视图:一键启动整个工作环境 -->
        <button v-if="s.view.type === 'combo'" class="btn btn-primary combo-run-btn"
                title="按顺序启动组合内的全部工具"
                @click="runCurrentCombo">
          ⚡ 一键启动
        </button>
      </div>

      <!-- 内容滚动区 -->
      <div class="content scroll-area">
        <!-- 空状态:还没有任何工具 -->
        <div v-if="isEmptyAll" class="empty-state enter-item">
          <div class="empty-icon">🚀</div>
          <h3>开始构建你的工具库</h3>
          <p>集中管理 .bat 脚本、.lnk 快捷方式和 .exe 程序,一键启动</p>
          <div class="empty-btns">
            <button class="btn btn-primary empty-btn" @click="s.toolModal.open = true; s.toolModal.editId = null">
              ＋ 添加第一个工具
            </button>
            <button class="btn empty-btn" @click="importPreset">📦 导入预设工具包</button>
          </div>
          <p class="empty-tip">
            把 <kbd>.exe</kbd> <kbd>.bat</kbd> <kbd>.lnk</kbd> 文件直接拖进窗口,自动填好一切<br />
            按 <kbd>Ctrl + K</kbd> 呼出命令面板 —— 输入几个字母,回车即启动
          </p>
        </div>

        <!-- 搜索无结果 -->
        <div v-else-if="isSearchEmpty" class="empty-state enter-item">
          <div class="empty-icon">🔍</div>
          <h3>没有找到「{{ s.search }}」</h3>
          <p>试试更短的关键词,或用拼音首字母(如「一键清理」→ yjql)<br />也可以按 <kbd>Ctrl + K</kbd> 用命令面板搜索</p>
        </div>

        <!-- 分组网格 -->
        <template v-else>
          <!-- 智能首页:问候 / 继续昨天 / AI 预测(仅最近使用视图,搜索时隐藏) -->
          <div v-if="s.view.type === 'recent' && !s.search.trim()" class="hero enter-item">
            <div class="hero-greet">
              {{ greeting() }}!今天已启动 <b>{{ todayRunCount }}</b> 次
            </div>
            <div v-if="continueTools.length" class="hero-row">
              <span class="hero-label">📌 继续昨天的工作</span>
              <button v-for="t in continueTools" :key="t.id" class="hero-chip"
                      :title="t.targetPath" @click="askRun(t)">
                <ToolIcon :tool="t" :size="16" />
                <span class="chip-name">{{ t.name }}</span>
              </button>
            </div>
            <div v-if="s.predictions.length && !s.dismissPredictions" class="hero-row predict">
              <span class="hero-label">✨ 这个时间你经常启动</span>
              <button v-for="t in s.predictions" :key="t.id" class="hero-chip glow"
                      :title="t.targetPath" @click="predictRun(t)">
                <ToolIcon :tool="t" :size="16" />
                <span class="chip-name">{{ t.name }}</span>
              </button>
              <button class="hero-dismiss" title="本次会话不再显示预测" @click="s.dismissPredictions = true">不再提醒</button>
            </div>
          </div>

          <section v-for="group in viewGroups" :key="group.key" class="group">
            <!-- 吸顶分组标题 -->
            <button v-if="s.view.type === 'all'"
                    class="group-head" :class="{ collapsed: isCollapsed(group.key) }"
                    @click="toggleCollapse(group.key)">
              <span class="g-arrow">‹</span>
              <span class="g-emoji">{{ group.emoji }}</span>
              <span class="g-title">{{ group.title }}</span>
              <span class="g-count">{{ group.tools.length }}</span>
            </button>
            <div v-else class="group-head static">
              <span class="g-emoji">{{ group.emoji }}</span>
              <span class="g-title">{{ group.title }}</span>
              <span class="g-count">{{ group.tools.length }}</span>
            </div>

            <!-- 折叠动画容器(grid-rows 技巧) -->
            <div class="collapse-wrap" :class="{ folded: isCollapsed(group.key) }">
              <div class="collapse-inner">
                <!-- 组内空提示 -->
                <div v-if="group.tools.length === 0" class="group-empty">
                  <template v-if="group.key === '__uncat'">此分类下暂无工具,添加工具时选择「未分类」或编辑已有工具归入</template>
                  <template v-else-if="s.view.type === 'star'">还没有常用工具:置顶或运行过的工具会出现在这里</template>
                  <template v-else>该分类下暂无工具</template>
                </div>
                <div v-else class="card-grid">
                  <ToolCard v-for="(tool, i) in group.tools" :key="tool.id"
                            :tool="tool" :index="i"
                            :show-last-run="s.view.type === 'recent'" />
                </div>
              </div>
            </div>
          </section>
        </template>
      </div>
    </template>
  </main>
</template>

<style scoped>
.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ---- 顶栏 ---- */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px 10px;
  flex-shrink: 0;
}
.view-info { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.view-title { font-size: 17px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
.view-count { font-size: 12px; color: var(--text-3); white-space: nowrap; }

.search-wrap {
  position: relative;
  margin-left: auto;
  width: 240px;
  flex-shrink: 1;
}
.search-ico {
  position: absolute;
  left: 9px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  opacity: 0.6;
  pointer-events: none;
}
.search-input {
  width: 100%;
  height: 32px;
  padding: 0 28px 0 28px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  font-size: 12.5px;
  color: var(--text-1);
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), width var(--dur-slow) var(--ease);
}
.search-input::placeholder { color: var(--text-3); }
.search-input:hover { background: var(--bg-input-hover); }
.search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.clear-btn {
  position: absolute;
  right: 6px; top: 50%;
  transform: translateY(-50%);
  width: 20px; height: 20px;
  border-radius: 50%;
  font-size: 9px;
  color: var(--text-3);
  display: grid; place-items: center;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.clear-btn:hover { background: var(--bg-card-hover); color: var(--text-1); }

/* 排序分段控件 */
.seg {
  display: flex;
  padding: 2px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  flex-shrink: 0;
}
.seg-item {
  height: 26px;
  padding: 0 11px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-3);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.seg-item:hover { color: var(--text-2); }
.seg-item.on {
  background: var(--bg-elevated);
  color: var(--text-1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.add-btn { flex-shrink: 0; height: 32px; }

/* 组合一键启动:带光晕强调 */
.combo-run-btn {
  flex-shrink: 0;
  height: 32px;
  background: linear-gradient(135deg, #4F8CFF, #7B5CFF);
  box-shadow: 0 2px 12px rgba(79, 140, 255, 0.35);
}
.combo-run-btn:hover {
  background: linear-gradient(135deg, #5E97FF, #8A6CFF);
  box-shadow: 0 3px 16px rgba(79, 140, 255, 0.5);
}

/* ---- 智能首页 hero(最近使用视图) ---- */
.hero {
  margin: 4px 0 18px;
  padding: 16px 18px;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  box-shadow: var(--shadow-card), inset 0 0 0 1px var(--divider);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-greet { font-size: 14.5px; color: var(--text-1); font-weight: 500; }
.hero-greet b { color: var(--accent); font-variant-numeric: tabular-nums; }
.hero-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hero-label { font-size: 12px; color: var(--text-3); margin-right: 2px; flex-shrink: 0; }
.hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px 0 8px;
  border-radius: 14px;
  background: var(--bg-input);
  border: 1px solid var(--divider);
  font-size: 12px;
  color: var(--text-1);
  max-width: 180px;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.hero-chip:hover { background: var(--bg-card-hover); border-color: var(--divider-strong); transform: translateY(-1px); }
.hero-chip:active { transform: scale(0.97); }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hero-chip.glow {
  background: var(--accent-soft);
  border-color: rgba(79, 140, 255, 0.35);
}
.hero-chip.glow:hover { box-shadow: 0 2px 10px rgba(79, 140, 255, 0.3); }
.hero-dismiss {
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 8px;
  border-radius: 10px;
  margin-left: auto;
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.hero-dismiss:hover { background: var(--bg-input); color: var(--text-2); }

/* ---- 内容区 ---- */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 20px 88px;
}

/* 分组 */
.group { margin-bottom: 18px; }
.group-head {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 6px;
  margin-bottom: 8px;
  border-radius: var(--radius-btn);
  background: transparent;
  transition: background var(--dur-fast) var(--ease);
  cursor: pointer;
  text-align: left;
  width: 100%;
}
/* 吸顶时加毛玻璃底(用 sticky + backdrop) */
.group-head::before {
  content: "";
  position: absolute;
  inset: -2px 0;
  z-index: -1;
  background: linear-gradient(var(--bg-window-fallback) 55%, transparent);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}
.group-head:hover::before { opacity: 0; }
.content.is-stuck .group-head::before { opacity: 1; }

.g-arrow {
  font-size: 13px;
  color: var(--text-3);
  transform: rotate(-90deg);
  transition: transform var(--dur-mid) var(--ease);
  width: 14px;
}
.group-head.collapsed .g-arrow { transform: rotate(0deg); }
.g-emoji { font-size: 14px; }
.g-title { font-size: 13px; font-weight: 600; color: var(--text-2); }
.group-head:hover .g-title { color: var(--text-1); }
.g-count {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 8px;
  border-radius: 10px;
}

.collapse-wrap {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--dur-slow) var(--ease);
}
.collapse-wrap.folded { grid-template-rows: 0fr; }
.collapse-inner { overflow: hidden; min-height: 0; }

.group-empty {
  padding: 22px;
  font-size: 12.5px;
  color: var(--text-3);
  border: 1px dashed var(--divider-strong);
  border-radius: var(--radius-card);
  text-align: center;
}

/* 卡片网格 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 12px;
}

/* ---- 空状态 ---- */
.empty-state {
  height: 100%;
  min-height: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
}
.empty-icon { font-size: 64px; margin-bottom: 6px; filter: drop-shadow(0 8px 20px rgba(79, 140, 255, 0.25)); }
.empty-state h3 { font-size: 17px; font-weight: 600; color: var(--text-1); }
.empty-state p { font-size: 13px; color: var(--text-3); line-height: 1.8; }
.empty-btns { display: flex; gap: 12px; margin-top: 14px; }
.empty-btn { height: 38px; padding: 0 22px; font-size: 13.5px; }
.empty-tip { margin-top: 12px; font-size: 12px; }
kbd {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--bg-input);
  border: 1px solid var(--divider-strong);
  border-bottom-width: 2px;
  font-family: var(--font);
  font-size: 11px;
  color: var(--text-2);
}
</style>
