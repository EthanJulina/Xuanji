<script setup>
// 首页工作台(应用启动默认页)
// 结构:① 问候 + 最近工作空间(点击进入)
//      ② 最近使用:工具图标横排,单击即启动
//      ③ 快速操作:新建工作空间 / 打开全部工具 / 唤起命令面板
// 红线:每个元素绑定动作,禁止纯展示卡片;全部「可点即达」
import { computed } from 'vue'
import {
  s, recentTools, greeting, todayRunCount, askRun, relativeTime, toast
} from '../composables/store'
import { recentWorkspaces, openWorkspace, sortedWorkspaces } from '../stores/workspaceStore'
import ToolIcon from './ToolIcon.vue'

// 最近使用:横排展示前 10 个,单击即启动
const recentStrip = computed(() => recentTools.value.slice(0, 10))
// 最近工作空间(不足时用最新的补位,保证「一键回到现场」)
const homeWorkspaces = computed(() => {
  if (recentWorkspaces.value.length) return recentWorkspaces.value
  return [...sortedWorkspaces.value].slice(0, 3)
})

function openPalette() { s.palette.open = true }
function newWorkspace() { s.wsModal.open = true; s.wsModal.editId = null }

function goTools() { s.view = { type: 'all', id: null } }
</script>

<template>
  <div class="home scroll-area">
    <!-- ① 问候 + 最近工作空间 -->
    <section class="hero enter-item">
      <div class="hero-greet">
        {{ greeting() }},欢迎回来
        <span class="hero-stat">今天已启动 <b>{{ todayRunCount }}</b> 次</span>
      </div>

      <div v-if="homeWorkspaces.length" class="hero-block">
        <div class="block-label">🎯 最近的工作空间</div>
        <div class="ws-cards">
          <button v-for="w in homeWorkspaces" :key="w.id" class="ws-card hover-lift press"
                  @click="openWorkspace(w.id)">
            <span class="ws-emoji" :style="{ background: (w.color || '#4F8CFF') + '26' }">{{ w.emoji || '🎯' }}</span>
            <span class="ws-info">
              <span class="ws-name ellipsis">{{ w.name }}</span>
              <span class="ws-meta">{{ (w.toolIds || []).length }} 个工具 · {{ w.lastOpenedAt ? relativeTime(w.lastOpenedAt) : '还没打开过' }}</span>
            </span>
            <span class="ws-arrow">→</span>
          </button>
        </div>
      </div>
      <div v-else class="hero-block">
        <div class="block-label">🎯 工作空间</div>
        <button class="ws-card ws-card-new hover-lift press" @click="newWorkspace">
          <span class="ws-emoji">➕</span>
          <span class="ws-info">
            <span class="ws-name">新建第一个工作空间</span>
            <span class="ws-meta">把一个项目的工具、目录、变量打包到一起</span>
          </span>
        </button>
      </div>
    </section>

    <!-- ② 最近使用:单击即启动 -->
    <section class="home-card enter-item" style="--i:1">
      <div class="card-head">
        <h4 class="card-title">🕘 最近使用</h4>
        <button class="link-btn" @click="s.view = { type: 'recent', id: null }">查看全部 →</button>
      </div>
      <div v-if="recentStrip.length" class="recent-strip">
        <button v-for="t in recentStrip" :key="t.id" class="recent-item hover-lift press"
                :title="`${t.name}\n${t.targetPath}`"
                @click="askRun(t)">
          <ToolIcon :tool="t" :size="38" />
          <span class="ri-name ellipsis">{{ t.name }}</span>
          <span v-if="s.procs.some(p => p.toolId === t.id)" class="ri-dot"></span>
        </button>
      </div>
      <div v-else class="card-empty">
        还没有启动记录 —— <button class="link-btn" @click="goTools">去工具库</button> 挑一个,或 <button class="link-btn" @click="openPalette">Ctrl+K</button> 搜索
      </div>
    </section>

    <!-- ③ 快速操作 -->
    <section class="home-card enter-item" style="--i:2">
      <div class="card-head">
        <h4 class="card-title">⚡ 快速操作</h4>
      </div>
      <div class="quick-grid">
        <button class="quick-btn hover-lift press" @click="newWorkspace">
          <span class="qb-icon">🎯</span>
          <span class="qb-main">新建工作空间</span>
          <span class="qb-sub">打包工具 / 目录 / 变量</span>
        </button>
        <button class="quick-btn hover-lift press" @click="goTools">
          <span class="qb-icon">🧰</span>
          <span class="qb-main">打开全部工具</span>
          <span class="qb-sub">{{ s.data.tools.length }} 个工具在库</span>
        </button>
        <button class="quick-btn hover-lift press" @click="openPalette">
          <span class="qb-icon">⌨️</span>
          <span class="qb-main">唤起命令面板</span>
          <span class="qb-sub">Ctrl + K 随时可用</span>
        </button>
      </div>
    </section>

    <p class="home-foot">玄机 · 纯本地运行,不联网、不上传任何数据</p>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  overflow-y: auto;
  padding: 10px 24px 96px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- 问候区 ---- */
.hero {
  padding: 18px 20px;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  box-shadow: var(--shadow-card), inset 0 0 0 1px var(--divider);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hero-greet { font-size: 16px; font-weight: 600; color: var(--text-1); display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.hero-stat { font-size: 12px; font-weight: 400; color: var(--text-3); }
.hero-stat b { color: var(--accent); font-variant-numeric: tabular-nums; }

.block-label { font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.ws-cards { display: flex; flex-direction: column; gap: 8px; }

.ws-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.ws-card:hover { background: var(--bg-card-hover); box-shadow: inset 0 0 0 1px var(--divider-strong); }
.ws-card-new { border: 1px dashed var(--divider-strong); background: transparent; }
.ws-card-new:hover { border-color: var(--accent); background: var(--accent-soft); }
.ws-emoji {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-size: 19px;
  flex-shrink: 0;
}
.ws-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ws-name { font-size: 13px; font-weight: 500; color: var(--text-1); }
.ws-meta { font-size: 11px; color: var(--text-3); }
.ws-arrow { color: var(--text-3); font-size: 14px; flex-shrink: 0; transition: transform var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
.ws-card:hover .ws-arrow { transform: translateX(3px); color: var(--accent); }

/* ---- 通用卡片 ---- */
.home-card {
  background: var(--bg-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card), inset 0 0 0 1px var(--divider);
  padding: 16px 18px;
}
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-2); }
.link-btn {
  font-size: 11.5px;
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 8px;
  transition: background var(--dur-fast) var(--ease);
}
.link-btn:hover { background: var(--accent-soft); }

/* ---- 最近使用横排 ---- */
.recent-strip { display: flex; gap: 10px; flex-wrap: wrap; }
.recent-item {
  position: relative;
  width: 86px;
  padding: 12px 6px 9px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.recent-item:hover { background: var(--bg-card-hover); box-shadow: inset 0 0 0 1px var(--divider-strong); }
.ri-name { font-size: 11.5px; color: var(--text-2); max-width: 100%; }
.ri-dot {
  position: absolute;
  top: 7px; right: 7px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse-dot 1.8s infinite;
}

.card-empty { font-size: 12.5px; color: var(--text-3); padding: 8px 0; }
.card-empty .link-btn { padding: 0 2px; }

/* ---- 快速操作 ---- */
.quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.quick-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.quick-btn:hover { background: var(--bg-card-hover); box-shadow: inset 0 0 0 1px var(--divider-strong); }
.qb-icon { font-size: 20px; }
.qb-main { font-size: 13px; font-weight: 500; color: var(--text-1); margin-top: 4px; }
.qb-sub { font-size: 11px; color: var(--text-3); }

.home-foot { text-align: center; font-size: 11px; color: var(--text-3); padding: 6px 0 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
