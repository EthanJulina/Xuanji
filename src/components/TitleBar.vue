<script setup>
// 自定义标题栏:右上红绿灯 + 左上运行中状态(名称·时长,PID/CPU/RAM 悬浮明细)
import { ref, computed, onMounted } from 'vue'
import { s } from '../composables/store'

const qd = window.qd
const maximized = ref(false)

onMounted(async () => {
  maximized.value = await qd.winIsMaximized()
  qd.onMaximized(v => { maximized.value = v })
})

function onDblClick() { qd.winToggleMaximize() }

/* ---- 运行中状态展示 ---- */
// 引用 s.procTick 建立响应依赖,实现秒级时长刷新
const procInfo = computed(() => {
  void s.procTick
  return s.procs.map(p => {
    const secs = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000))
    return {
      ...p,
      dur: secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`,
      ram: p.ram ? (p.ram / 1024).toFixed(0) + ' MB' : '—',
      cpu: p.cpu ? p.cpu + '%' : '—'
    }
  })
})

const firstProc = computed(() => procInfo.value[0])

// 悬浮明细:列出全部运行中进程
const procTitle = computed(() =>
  procInfo.value.map(p => `${p.name}\n  PID ${p.pid} · CPU ${p.cpu} · 内存 ${p.ram} · 已运行 ${p.dur}`).join('\n\n')
)
</script>

<template>
  <header class="titlebar drag-region" @dblclick="onDblClick">
    <!-- 左上角:运行中状态(悬浮显示 PID/CPU/内存明细) -->
    <div class="left-zone no-drag">
      <span v-if="firstProc" class="proc-hint" :title="procTitle">
        <i class="live-dot"></i>
        <span class="proc-name">{{ firstProc.name }}</span>
        <span class="proc-dur">{{ firstProc.dur }}</span>
        <span v-if="s.procs.length > 1" class="proc-more">+{{ s.procs.length - 1 }}</span>
      </span>
    </div>

    <div class="app-title">
      <span class="logo-dot"></span>
      玄机
    </div>

    <!-- 右上角:macOS 式红黄绿圆点,容器 hover 时显示符号 -->
    <div class="traffic no-drag">
      <button class="dot red" title="关闭" @click.stop="qd.winClose()">
        <span class="glyph">×</span>
      </button>
      <button class="dot yellow" title="最小化" @click.stop="qd.winMinimize()">
        <span class="glyph">−</span>
      </button>
      <button class="dot green" :title="maximized ? '还原' : '最大化'" @click.stop="qd.winToggleMaximize()">
        <span class="glyph">{{ maximized ? '⤡' : '+' }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  position: relative;
  z-index: 30;
}

/* 红绿灯 */
.traffic { display: flex; align-items: center; gap: 8px; }
.dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  position: relative;
  display: grid; place-items: center;
  transition: filter var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.dot:hover { filter: brightness(1.12); }
.dot:active { transform: scale(0.92); }
.dot.red { background: #FF5F57; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.12); }
.dot.yellow { background: #FEBC2E; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.12); }
.dot.green { background: #28C840; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.12); }
.glyph {
  font-size: 9px; line-height: 1; font-weight: 700;
  color: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}
.traffic:hover .glyph { opacity: 1; }

/* 居中标题 */
.app-title {
  position: absolute;
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  letter-spacing: 0.2px;
  pointer-events: none;
}
.logo-dot {
  width: 10px; height: 10px;
  border-radius: 3px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 0 8px rgba(79, 140, 255, 0.5);
}

.left-zone { margin-right: auto; display: flex; align-items: center; }
.proc-hint {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11.5px; color: var(--text-3);
  padding: 3px 10px;
  border-radius: 20px;
  background: var(--bg-card);
  cursor: default;
}
.proc-name { color: var(--text-2); font-weight: 500; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proc-dur { color: var(--text-3); font-variant-numeric: tabular-nums; }
.proc-more {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-3);
}
.live-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--success);
  animation: pulse-dot 2s infinite;
}
</style>
