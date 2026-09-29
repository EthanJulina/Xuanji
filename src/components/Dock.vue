<script setup>
// ============================================================
// 玄机 - 底部 Dock(v2.1 重构:macOS 式自动隐藏)
// 三档模式 settings.dock.mode:
//   auto(默认) — 底部 6px 触发细条唤出,离开 400ms 收回;隐藏时本体无任何 DOM 视觉
//   fixed      — 常驻;主内容滚动容器预留底部 padding(App.vue 绑 dock-reserved)
//   off        — 触发区/本体/padding 全部移除
// 内容 = 已固定工具(pinnedToolIds,上限 10)+ 运行中未固定(细分隔线隔开)
// 互斥:命令面板 / 任意弹窗打开时强制隐藏且不可唤出(dockBlocked)
// 视觉:毛玻璃 blur24+sat1.6 / 圆角18 / 描边+多层阴影;hover 1.2 + 相邻距离衰减;
//       tooltip 名称+状态;运行 6px 呼吸圆点;按压 0.95
// ============================================================
import { ref, computed, watch, onUnmounted } from 'vue'
import { s, isRunning } from '../composables/store'
import {
  dock, dockMode, dockBlocked, dockPinnedTools, dockRunningExtras,
  dockClick, dockMenu, reorderDockPinned
} from '../stores/dockStore'
import ToolIcon from './ToolIcon.vue'

const layerEl = ref(null)

// 显示条件:互斥时一律隐藏;fixed 常驻;auto 看 peek;off 永不
const show = computed(() => {
  if (dockBlocked.value) return false
  if (dockMode.value === 'fixed') return true
  if (dockMode.value === 'auto') return dock.peek
  return false
})

/* ---- auto:触发与 400ms 延迟收回 ---- */
function peekOn() { clearTimeout(hideTimer); dock.peek = true }
let hideTimer = null
function scheduleHide() {
  if (dockMode.value !== 'auto') return
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { dock.peek = false }, 400)
}

/* ---- macOS 手感:hover 放大 1.2,相邻按距离衰减(rAF 节流) ---- */
let raf = 0
function onMove(e) {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    const items = layerEl.value?.querySelectorAll('.dock-item')
    if (!items) return
    for (const el of items) {
      const r = el.getBoundingClientRect()
      const d = Math.abs(e.clientX - (r.left + r.width / 2))
      const k = Math.max(0, 1 - d / 120)              // 影响半径 120px,线性衰减
      el.style.setProperty('--lift', (1 + 0.2 * k).toFixed(3))
    }
  })
}
function resetLift() {
  cancelAnimationFrame(raf)
  layerEl.value?.querySelectorAll('.dock-item').forEach(el => el.style.setProperty('--lift', '1'))
}

/* ---- 固定区拖拽排序(HTML5 drag,前后插入位) ---- */
function onDragStart(e, t) {
  dock.dragId = t.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', t.id)
}
function onDragOver(e, t) {
  if (!dock.dragId || dock.dragId === t.id) return
  e.preventDefault()
  const r = e.currentTarget.getBoundingClientRect()
  dock.overId = t.id
  dock.dragPos = (e.clientX - r.left) < r.width / 2 ? 'before' : 'after'
}
function onDrop(e, t) {
  const { dragId, dragPos } = dock
  if (dragId && t.id !== dragId) {
    const ids = (s.data.settings.dock?.pinnedToolIds || []).filter(Boolean)
    const from = ids.indexOf(dragId)
    let to = ids.indexOf(t.id)
    if (from > -1 && to > -1) {
      const [moved] = ids.splice(from, 1)
      if (from < to) to -= 1
      ids.splice(dragPos === 'before' ? to : to + 1, 0, moved)
      reorderDockPinned(ids)
    }
  }
  onDragEnd()
}
function onDragEnd() { dock.dragId = dock.overId = dock.dragPos = null }

// 互斥打开时收起并取消收回定时(关闭弹窗后:fixed 自动恢复;auto 需重新触底唤出)
watch(dockBlocked, b => {
  if (b) { dock.peek = false; clearTimeout(hideTimer) }
})

const iconSize = computed(() => s.data.settings.dock?.iconSize || 44)

onUnmounted(() => { clearTimeout(hideTimer); cancelAnimationFrame(raf) })
</script>

<template>
  <!-- auto 模式触发细条:6px 透明,pointer-events 仅此细条,绝不遮挡上方内容的点击 -->
  <div v-if="dockMode === 'auto' && !dockBlocked"
       class="dock-trigger no-drag" @mouseenter="peekOn"></div>

  <Transition name="dock">
    <div v-if="show" ref="layerEl" class="dock-layer no-drag"
         :style="{ '--di': iconSize + 'px' }"
         @mousemove="onMove"
         @mouseleave="scheduleHide(); resetLift()">
      <div class="dock">
        <!-- 空态:引导文案,不留一排空图标 -->
        <div v-if="!dockPinnedTools.length && !dockRunningExtras.length" class="dock-empty">
          右键工具卡片可固定到 Dock
        </div>

        <template v-else>
          <!-- 固定区(可拖拽排序 / 右键管理) -->
          <button v-for="t in dockPinnedTools" :key="'p-' + t.id"
                  class="dock-item"
                  :class="{
                    running: isRunning(t.id),
                    dragging: dock.dragId === t.id,
                    'drop-before': dock.overId === t.id && dock.dragPos === 'before' && dock.dragId !== t.id,
                    'drop-after': dock.overId === t.id && dock.dragPos === 'after' && dock.dragId !== t.id
                  }"
                  draggable="true"
                  @dragstart="e => onDragStart(e, t)"
                  @dragover="e => onDragOver(e, t)"
                  @drop="e => onDrop(e, t)"
                  @dragend="onDragEnd"
                  @click="dockClick($event, t)"
                  @contextmenu.prevent="dockMenu($event, t, true)">
            <span class="di-tip">{{ t.name }}<em :class="{ on: isRunning(t.id) }">{{ isRunning(t.id) ? '运行中' : '未运行' }}</em></span>
            <span class="di-pad"><ToolIcon :tool="t" :size="32" /></span>
            <span v-if="isRunning(t.id)" class="di-dot"></span>
          </button>

          <!-- 固定区 | 运行区 分隔线 -->
          <div v-if="dockPinnedTools.length && dockRunningExtras.length" class="dock-sep"></div>

          <!-- 运行区:正在运行但未固定(启动顺序,不可拖) -->
          <button v-for="t in dockRunningExtras" :key="'r-' + t.id"
                  class="dock-item running"
                  @click="dockClick($event, t)"
                  @contextmenu.prevent="dockMenu($event, t, false)">
            <span class="di-tip">{{ t.name }}<em class="on">运行中</em></span>
            <span class="di-pad"><ToolIcon :tool="t" :size="32" /></span>
            <span class="di-dot"></span>
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ---- auto 触发细条:仅底部 6px 响应,视觉透明 ---- */
.dock-trigger {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  height: 6px;
  z-index: 59;
  pointer-events: auto;     /* 仅该细条接收事件,上方内容不受影响 */
  background: transparent;
}

/* ---- 悬浮层:占满底宽但仅本体可交互 ---- */
.dock-layer {
  position: fixed;
  left: 0; right: 0; bottom: 10px;
  display: flex;
  justify-content: center;
  z-index: 60;
  pointer-events: none;     /* 本体以外的区域完全穿透 */
}

/* ---- Dock 本体 ---- */
.dock {
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 18px;
  background: var(--bg-elevated);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.42),
    0 6px 16px rgba(0, 0, 0, 0.28),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.dock-empty {
  padding: 10px 18px;
  font-size: 12.5px;
  color: var(--text-3);
  white-space: nowrap;
}

/* ---- 图标占位 44px(读 settings.dock.iconSize) ---- */
.dock-item {
  position: relative;
  width: var(--di, 44px);
  height: var(--di, 44px);
  border-radius: 12px;
  display: grid;
  place-items: center;
  transform: scale(var(--lift, 1));
  transform-origin: bottom center;
  transition: transform 150ms var(--ease), opacity var(--dur-fast) var(--ease);
}
.dock-item:active { transform: scale(calc(var(--lift, 1) * 0.95)); }   /* 按压 0.95 */

/* 拖拽排序状态 */
.dock-item.dragging { opacity: 0.4; }
.dock-item.drop-before { box-shadow: -3px 0 0 0 var(--accent); border-radius: 12px; }
.dock-item.drop-after { box-shadow: 3px 0 0 0 var(--accent); border-radius: 12px; }

/* 图标底衬:消除白色文件图标在深色主题下的突兀感 */
.di-pad {
  width: calc(var(--di, 44px) - 8px);
  height: calc(var(--di, 44px) - 8px);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  display: grid;
  place-items: center;
}

/* ---- tooltip:名称完整可读 + 状态 ---- */
.di-tip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) scale(0.9);
  padding: 5px 11px;
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-pop), inset 0 0 0 1px var(--divider);
  font-size: 12px;
  color: var(--text-1);
  white-space: nowrap;              /* 名称必显不截断 */
  max-width: none;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
  z-index: 2;
}
.di-tip em {
  font-style: normal;
  margin-left: 7px;
  font-size: 10.5px;
  color: var(--text-3);
}
.di-tip em.on { color: var(--accent); }
.dock-item:hover .di-tip { opacity: 1; transform: translateX(-50%) scale(1); }

/* ---- 运行指示:6px 呼吸圆点 ---- */
.di-dot {
  position: absolute;
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: di-breathe 1.8s var(--ease) infinite;
}
@keyframes di-breathe {
  0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
  50% { opacity: 0.45; transform: translateX(-50%) scale(0.8); }
}

/* ---- 固定区|运行区 分隔线 ---- */
.dock-sep {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--divider-strong);
}

/* ---- 滑出/收回:250ms cubic-bezier(0.2,0,0,1) ---- */
.dock-enter-active, .dock-leave-active { transition: transform 250ms cubic-bezier(0.2, 0, 0, 1), opacity 250ms cubic-bezier(0.2, 0, 0, 1); }
.dock-enter-from, .dock-leave-to { transform: translateY(calc(100% + 14px)); opacity: 0.4; }
</style>

<style>
/* 非 scoped:常驻模式下主内容滚动容器预留底部空间(约 88px) */
.app-body.dock-reserved .content,
.app-body.dock-reserved .home,
.app-body.dock-reserved .ws-view,
.app-body.dock-reserved .settings { padding-bottom: 88px; }
</style>
