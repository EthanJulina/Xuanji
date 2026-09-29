<script setup>
// 玄机 - 根组件
// 布局:标题栏(横贯顶部)+ 侧边栏 + 主内容区;弹窗/Dock/命令面板为浮层
import { onMounted, onUnmounted } from 'vue'
import { s, init, closeContextMenu, persist, toast } from './composables/store'
import { dockFixedShow } from './stores/dockStore'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import MainArea from './components/MainArea.vue'
import CommandPalette from './components/CommandPalette.vue'
import ToolModal from './components/ToolModal.vue'
import CategoryModal from './components/CategoryModal.vue'
import ComboModal from './components/ComboModal.vue'
import WorkspaceModal from './components/WorkspaceModal.vue'
import WorkspaceAddTools from './components/WorkspaceAddTools.vue'
import DeleteModal from './components/DeleteModal.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import LogPanel from './components/LogPanel.vue'
import CommandRunModal from './components/CommandRunModal.vue'
import HealthPanel from './components/HealthPanel.vue'
import ToastStack from './components/ToastStack.vue'
import ContextMenuHost from './components/ContextMenuHost.vue'
import Dock from './components/Dock.vue'

function onGlobalMousedown() { closeContextMenu() }

/* ---- 拖拽添加:把 .exe/.bat/.cmd/.lnk 拖进窗口,自动识别并预填添加弹窗 ---- */
function onDragOver(e) {
  e.preventDefault()                       // 阻止 Electron 默认的文件导航
  e.dataTransfer.dropEffect = 'copy'
}
function onDrop(e) {
  e.preventDefault()
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  const ok = files.map(f => f.path).filter(p => /\.(exe|bat|cmd|lnk)$/i.test(p || ''))
  if (!ok.length) { toast('仅支持拖入 .exe / .bat / .cmd / .lnk 文件', 'error'); return }
  if (ok.length > 1) toast('一次添加一个,已取第一个文件', 'info')
  s.toolModal.open = true
  s.toolModal.editId = null
  s.toolModal.dropPath = ok[0]             // ToolModal 打开时自动预填
}

onMounted(async () => {
  window.addEventListener('mousedown', onGlobalMousedown)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  // 页面卸载前立即持久化,避免防抖丢失
  window.addEventListener('beforeunload', () => persist(true))
  await init()
  // 系统主题变化时,若为「跟随系统」则自动切换
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (s.data.settings.theme === 'system') {
      import('./composables/store').then(m => m.applyTheme('system'))
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('mousedown', onGlobalMousedown)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <!-- Dock 常驻模式:主内容滚动容器预留底部 padding(规则见 Dock.vue 非 scoped 样式) -->
    <div class="app-body" :class="{ 'dock-reserved': dockFixedShow }">
      <Sidebar />
      <MainArea />
    </div>

    <!-- 浮层 -->
    <Dock />
    <CommandPalette />
    <ToolModal />
    <CategoryModal />
    <ComboModal />
    <WorkspaceModal />
    <WorkspaceAddTools />
    <DeleteModal />
    <ConfirmModal />
    <LogPanel />
    <CommandRunModal />
    <HealthPanel />
    <ContextMenuHost />
    <ToastStack />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  overflow: hidden;
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  z-index: 1;
}
</style>
