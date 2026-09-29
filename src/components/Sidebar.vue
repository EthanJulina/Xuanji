<script setup>
// 侧边栏:工作空间分区(分类之上)+ 分类导航 + 组合 + P1/P2 占位入口
// 滑动指示条 / 数量角标 / 右键菜单 / 底部入口
import { ref, watch, nextTick, onMounted } from 'vue'
import {
  s, setView, sortedCategories, sortedCombos, countOfCategory, totalCount, pinnedCount,
  uncatCount, recentTools, openContextMenu, removeCategory, removeCombo, confirmBox, toast
} from '../composables/store'
import {
  sortedWorkspaces, openWorkspace, removeWorkspace
} from '../stores/workspaceStore'
import ComboModal from './ComboModal.vue'

const qd = window.qd
const listEl = ref(null)
const indicator = ref({ top: 0, height: 0, opacity: 0 })
const itemRefs = new Map()

function setItemRef(el, key) {
  if (el) itemRefs.set(key, el)
}

// 选中项变化时滑动指示条(offsetTop 相对滚动容器内元素,随滚动自然跟随)
function moveIndicator() {
  nextTick(() => {
    const key = s.view.type === 'cat' ? 'cat:' + s.view.id
      : s.view.type === 'workspace' ? 'ws:' + s.view.id
      : s.view.type === 'dev' ? 'dev:' + s.view.id
      : s.view.type
    const el = itemRefs.get(key)
    if (!el || !listEl.value) { indicator.value.opacity = 0; return }
    indicator.value = { top: el.offsetTop, height: el.offsetHeight, opacity: 1 }
  })
}

watch(() => [s.view.type, s.view.id, s.data.categories.length], moveIndicator)
onMounted(moveIndicator)

function openCat(cat) { setView({ type: 'cat', id: cat.id }) }

/* ---- 工作空间右键菜单:重命名 / 换图标 / 删除 ---- */
function wsContextMenu(e, wsItem) {
  openContextMenu(e, [
    { icon: '✏️', label: '重命名 / 换图标', action: () => { s.wsModal.open = true; s.wsModal.editId = wsItem.id } },
    {
      icon: '🗑', label: '删除工作空间', danger: true,
      action: async () => {
        const yes = await confirmBox({
          title: '删除工作空间',
          message: `确定删除「${wsItem.emoji} ${wsItem.name}」吗?`,
          detail: '仅删除空间本身;空间引用的工具、目录指向的文件都不会被触碰。',
          confirmText: '删除'
        })
        if (yes) { await removeWorkspace(wsItem.id); toast('工作空间已删除(工具与文件不受影响)', 'success') }
      }
    }
  ])
}

// 组合右键菜单:启动 / 编辑 / 删除
function comboContextMenu(e, combo) {
  openContextMenu(e, [
    { icon: '⚡', label: '一键启动', action: () => setView({ type: 'combo', id: combo.id }) },
    { icon: '✏️', label: '编辑组合', action: () => { s.comboModal.open = true; s.comboModal.editId = combo.id } },
    {
      icon: '🗑', label: '删除组合', danger: true,
      action: async () => {
        const yes = await confirmBox({
          title: '删除组合',
          message: `确定删除组合「${combo.emoji} ${combo.name}」吗?`,
          detail: '仅删除组合条目,组合内的工具本身不受影响。',
          confirmText: '删除'
        })
        if (yes) { removeCombo(combo.id); toast('组合已删除', 'success') }
      }
    }
  ])
}

// 分类右键菜单:重命名 / 换图标 / 删除
function catContextMenu(e, cat) {
  openContextMenu(e, [
    { icon: '✏️', label: '重命名', action: () => setView({ type: 'cat', id: cat.id }), hint: 'rename:' + cat.id },
    { icon: '🎨', label: '换图标 / 颜色', action: () => { s.catModal.open = true } },
    {
      icon: '🗑', label: '删除分类', danger: true,
      action: async () => {
        const yes = await confirmBox({
          title: '删除分类',
          message: `确定删除分类「${cat.emoji} ${cat.name}」吗?`,
          detail: '分类下的工具会移入「未分类」,不会删除工具本身。',
          confirmText: '删除'
        })
        if (yes) { removeCategory(cat.id); toast('分类已删除,工具已移入未分类', 'success') }
      }
    }
  ])
}

// 分类分区右键:管理分类(替代原底部按钮;分区标题上右键呼出)
function catSectionMenu(e) {
  openContextMenu(e, [
    { icon: '🗂', label: '管理分类', action: () => { s.catModal.open = true; s.catModal.mode = 'manage' } }
  ])
}

/* ---- P1/P2 占位入口(点击显示「开发中」占位页) ---- */
// v2.1:logsplus → 日志中心、commands → 命令库、resources → 资源中心、envcheck → 环境健康检查 已落地,移出占位列表
// 环境健康检查入口:设置页「环境健康检查」区块(模板管理)+ 工具编辑弹窗「环境检查」标签(挂载)
const DEV_ENTRIES = [
  { id: 'proxy', icon: '🌐', name: '代理管理 Proxy' },
  { id: 'sessions', icon: '📝', name: '测试记录 Session' }
]
function openDev(id) { setView({ type: 'dev', id }) }
</script>

<template>
  <aside class="sidebar">
    <!-- 导航区独立滚动;底部 footer 常驻不遮挡(v2.0.1 修复 sticky 悬浮重叠) -->
    <nav ref="listEl" class="nav-list scroll-area">
      <!-- 滑动选中指示条 -->
      <div class="indicator" :style="{
        top: indicator.top + 'px',
        height: indicator.height + 'px',
        opacity: indicator.opacity
      }"></div>

      <!-- 固定:首页 -->
      <button :ref="el => setItemRef(el, 'home')"
              class="nav-item" :class="{ active: s.view.type === 'home' }"
              @click="setView({ type: 'home', id: null })">
        <span class="n-icon">🏠</span>
        <span class="n-name">首页</span>
      </button>

      <!-- 固定:全部工具 -->
      <button :ref="el => setItemRef(el, 'all')"
              class="nav-item" :class="{ active: s.view.type === 'all' }"
              @click="setView({ type: 'all', id: null })">
        <span class="n-icon">🧰</span>
        <span class="n-name">全部工具</span>
        <span class="n-count">{{ totalCount }}</span>
      </button>

      <!-- 固定:常用 -->
      <button :ref="el => setItemRef(el, 'star')"
              class="nav-item" :class="{ active: s.view.type === 'star' }"
              @click="setView({ type: 'star', id: null })">
        <span class="n-icon">⭐</span>
        <span class="n-name">常用</span>
        <span class="n-count">{{ pinnedCount }}</span>
      </button>

      <!-- 固定:最近使用 -->
      <button :ref="el => setItemRef(el, 'recent')"
              class="nav-item" :class="{ active: s.view.type === 'recent' }"
              @click="setView({ type: 'recent', id: null })">
        <span class="n-icon">🕘</span>
        <span class="n-name">最近使用</span>
        <span class="n-count">{{ recentTools.length }}</span>
      </button>

      <!-- ===== 工作空间分区(置于分类之上)===== -->
      <div class="section-label">
        工作空间
        <button class="label-add" title="新建工作空间"
                @click.stop="s.wsModal.open = true; s.wsModal.editId = null">＋</button>
      </div>

      <button v-for="w in sortedWorkspaces" :key="w.id"
              :ref="el => setItemRef(el, 'ws:' + w.id)"
              class="nav-item" :class="{ active: s.view.type === 'workspace' && s.view.id === w.id }"
              @click="openWorkspace(w.id)"
              @contextmenu="wsContextMenu($event, w)"
              :title="w.name">
        <span class="n-icon ws-dot" :style="{ background: (w.color || '#4F8CFF') + '26' }">{{ w.emoji || '🎯' }}</span>
        <span class="n-name">{{ w.name }}</span>
        <span class="n-count">{{ (w.toolIds || []).length }}</span>
      </button>

      <button v-if="!sortedWorkspaces.length" class="nav-item new-ws"
              @click="s.wsModal.open = true; s.wsModal.editId = null">
        <span class="n-icon">➕</span>
        <span class="n-name">新建工作空间</span>
      </button>

      <!-- 分区标题自带「+」新建入口;右键提供「管理分类」(v2.1:底部操作区收敛) -->
      <div class="section-label" @contextmenu.prevent="catSectionMenu">
        分类
        <button class="label-add" title="新建分类"
                @click.stop="s.catModal.open = true; s.catModal.mode = 'create'">＋</button>
      </div>

      <!-- 自定义分类 -->
      <button v-for="cat in sortedCategories" :key="cat.id"
              :ref="el => setItemRef(el, 'cat:' + cat.id)"
              class="nav-item" :class="{ active: s.view.type === 'cat' && s.view.id === cat.id }"
              @click="openCat(cat)"
              @contextmenu="catContextMenu($event, cat)"
              :title="cat.name">
        <span class="n-icon cat-dot" :style="{ background: cat.color + '26', color: cat.color }">{{ cat.emoji }}</span>
        <span class="n-name">{{ cat.name }}</span>
        <span class="n-count">{{ countOfCategory(cat.id) }}</span>
      </button>

      <div v-if="sortedCategories.length === 0" class="empty-cats">还没有自定义分类</div>

      <!-- 组合分区(常驻标题 + 「+」新建,替代原底部按钮) -->
      <div class="section-label">
        组合
        <button class="label-add" title="新建组合"
                @click.stop="s.comboModal.open = true; s.comboModal.editId = null">＋</button>
      </div>

      <!-- 工具组合:一键启动工作环境 -->
      <button v-for="combo in sortedCombos" :key="combo.id"
              :ref="el => setItemRef(el, 'combo:' + combo.id)"
              class="nav-item" :class="{ active: s.view.type === 'combo' && s.view.id === combo.id }"
              @click="setView({ type: 'combo', id: combo.id })"
              @contextmenu="comboContextMenu($event, combo)"
              :title="combo.name">
        <span class="n-icon">{{ combo.emoji }}</span>
        <span class="n-name">{{ combo.name }}</span>
        <span class="n-count">{{ combo.toolIds.length }}</span>
      </button>

      <!-- ===== v2.1 已落地功能(真实视图)===== -->
      <div class="section-label">工具箱</div>
      <button :ref="el => setItemRef(el, 'commandvault')"
              class="nav-item" :class="{ active: s.view.type === 'commandvault' }"
              @click="setView({ type: 'commandvault', id: null })">
        <span class="n-icon">⌨️</span>
        <span class="n-name">命令库</span>
        <span class="n-count">{{ (s.data.commands || []).length }}</span>
      </button>
      <button :ref="el => setItemRef(el, 'resourcecenter')"
              class="nav-item" :class="{ active: s.view.type === 'resourcecenter' }"
              @click="setView({ type: 'resourcecenter', id: null })">
        <span class="n-icon">🗂</span>
        <span class="n-name">资源中心</span>
        <span class="n-count">{{ (s.data.resources || []).length }}</span>
      </button>
      <button :ref="el => setItemRef(el, 'logcenter')"
              class="nav-item" :class="{ active: s.view.type === 'logcenter' }"
              @click="setView({ type: 'logcenter', id: null })">
        <span class="n-icon">📋</span>
        <span class="n-name">日志中心</span>
      </button>

      <!-- ===== P1/P2 占位入口(仅入口,点击显示「开发中」)===== -->
      <div class="section-label">规划中</div>
      <button v-for="d in DEV_ENTRIES" :key="d.id"
              :ref="el => setItemRef(el, 'dev:' + d.id)"
              class="nav-item dev-item" :class="{ active: s.view.type === 'dev' && s.view.id === d.id }"
              @click="openDev(d.id)"
              :title="d.name + '(开发中)'">
        <span class="n-icon">{{ d.icon }}</span>
        <span class="n-name">{{ d.name }}</span>
        <span class="n-dev">开发中</span>
      </button>

      <!-- 固定置底:未分类 -->
      <button :ref="el => setItemRef(el, 'uncat')"
              class="nav-item uncat" :class="{ active: s.view.type === 'uncat' }"
              @click="setView({ type: 'uncat', id: null })">
        <span class="n-icon">📥</span>
        <span class="n-name">未分类</span>
        <span class="n-count" :class="{ warn: uncatCount > 0 }">{{ uncatCount }}</span>
      </button>
    </nav>

    <!-- 底部只留「设置」(v2.1:新建/管理操作已并入对应分区「+」与右键菜单) -->
    <div class="sidebar-footer">
      <button class="foot-btn" :class="{ active: s.view.type === 'settings' }" @click="setView({ type: 'settings', id: null })">
        <span>⚙️</span>设置
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  backdrop-filter: blur(20px) saturate(1.5);
  border-right: 1px solid var(--divider);
  overflow: hidden;               /* 容器不滚:滚动下沉到 nav-list,footer 常驻 */
  padding: 10px 10px 0;
}
.nav-list {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;                  /* 允许收缩触发自身滚动 */
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 10px;
}

.indicator {
  position: absolute;
  left: 0; right: 0;
  border-radius: var(--radius-btn);
  background: var(--accent-soft);
  border: 1px solid rgba(79, 140, 255, 0.22);
  pointer-events: none;
  transition: top 240ms var(--ease), height 240ms var(--ease), opacity var(--dur-mid) var(--ease);
  z-index: 0;
}

.nav-item {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  color: var(--text-2);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.nav-item:hover { background: var(--bg-card-hover); color: var(--text-1); }
.nav-item:active { transform: scale(0.98); }
.nav-item.active { color: var(--text-1); font-weight: 500; }

.n-icon {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  font-size: 14px;
  border-radius: 6px;
  flex-shrink: 0;
}
.cat-dot, .ws-dot { box-shadow: inset 0 0 0 1px var(--divider); }
.n-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.n-count {
  min-width: 20px;
  text-align: center;
  font-size: 11px;
  line-height: 17px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--bg-card);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.nav-item.active .n-count { background: rgba(79, 140, 255, 0.25); color: var(--accent); }
.n-count.warn { background: rgba(254, 188, 46, 0.16); color: var(--warning); }

/* 工作空间空态引导 */
.new-ws { color: var(--text-3); border: 1px dashed var(--divider-strong); margin: 2px 0; }
.new-ws:hover { color: var(--accent); border-color: var(--accent); }

/* P1/P2 占位入口 */
.dev-item { color: var(--text-3); }
.dev-item:hover { color: var(--text-2); }
.n-dev {
  font-size: 9.5px;
  color: var(--warning);
  background: rgba(254, 188, 46, 0.12);
  padding: 1px 7px;
  border-radius: 8px;
  flex-shrink: 0;
}

.section-label {
  margin: 14px 10px 6px;
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label-add {
  width: 18px; height: 18px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--text-3);
  display: grid; place-items: center;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.label-add:hover { background: var(--accent-soft); color: var(--accent); }
.empty-cats {
  margin: 4px 10px 8px;
  font-size: 12px;
  color: var(--text-3);
  padding: 8px 10px;
  border: 1px dashed var(--divider-strong);
  border-radius: var(--radius-btn);
}

.uncat { margin-top: 12px; }

.sidebar-footer {
  flex-shrink: 0;                 /* 常驻底部,不参与滚动、不悬浮遮挡 */
  padding: 10px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--divider);
}
.foot-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-btn);
  font-size: 12.5px;
  color: var(--text-3);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.foot-btn:hover { background: var(--bg-card-hover); color: var(--text-1); }
.foot-btn:active { transform: scale(0.98); }
.foot-btn.active { color: var(--accent); background: var(--accent-soft); }
.foot-btn span { width: 20px; text-align: center; font-size: 13px; }
</style>
