<script setup>
// P1/P2 占位页:点击侧边栏「规划中」入口时显示
// 本期(P0 轮)仅数据结构 + 入口占位,不写任何业务 UI 与逻辑
const PROPS_MAP = {
  commands: {
    icon: '⌨️', title: '命令库 Command Vault',
    desc: '安全命令模板中心:Nmap / nuclei / sqlmap 等常用命令的参数化模板,变量取自工作空间变量,一键复制、一键运行。',
    tags: ['P1', '命令模板', '{{变量}} 渲染', 'varMemory 记忆']
  },
  resources: {
    icon: '🗂', title: 'Payload / 资源中心',
    desc: '文件与目录的引用式管理:添加引用 + 标签 + 收藏 + 搜索,绝不移动或复制你的原始文件。',
    tags: ['P1', '引用式管理', '标签 / 收藏']
  },
  logsplus: {
    icon: '📋', title: '日志中心(增强)',
    desc: '等级化日志:搜索 / 复制 / 导出;可配置正则自动识别错误,单文件超 5MB 滚动截断。',
    tags: ['P1', 'INFO/SUCCESS/WARNING/ERROR', '错误正则表']
  },
  envcheck: {
    icon: '🩺', title: '环境健康检查',
    desc: '可配置检测模板(exec 命令 / 端口存活 / 文件存在),内置 java / python / pip 预设;启动前红绿提示 + 修复建议。',
    tags: ['P1', '检测模板', '结果缓存']
  },
  proxy: {
    icon: '🌐', title: '代理管理 Proxy',
    desc: '直连 / Burp / 自定义模式切换;仅操作 HKCU Internet Settings,修改前快照、一键还原、恢复标记文件。',
    tags: ['P2', '快照还原', '凭据 safeStorage 加密']
  },
  sessions: {
    icon: '📝', title: '测试记录 Session',
    desc: '自动记录 tool_run / command / proxy_switch 事件,支持手动备注;test-history.md 仅在显式导出时生成。',
    tags: ['P2', '事件流', '显式导出']
  }
}

const props = defineProps({
  id: { type: String, required: true }
})
const meta = PROPS_MAP[props.id] || { icon: '🚧', title: '开发中', desc: '该功能正在规划中。', tags: [] }
</script>

<template>
  <div class="dev-placeholder enter-item">
    <div class="dev-icon">{{ meta.icon }}</div>
    <div class="dev-badge">开发中</div>
    <h3 class="dev-title">{{ meta.title }}</h3>
    <p class="dev-desc">{{ meta.desc }}</p>
    <div class="dev-tags">
      <span v-for="t in meta.tags" :key="t" class="dev-tag">{{ t }}</span>
    </div>
    <p class="dev-note">本期已落地该模块的数据结构与存储(schema v2.0),功能界面将在后续版本推出。</p>
  </div>
</template>

<style scoped>
.dev-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 40px 24px;
}
.dev-icon {
  font-size: 56px;
  filter: drop-shadow(0 8px 20px rgba(79, 140, 255, 0.2));
}
.dev-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--warning);
  background: rgba(254, 188, 46, 0.12);
  padding: 3px 12px;
  border-radius: 12px;
  letter-spacing: 2px;
}
.dev-title { font-size: 17px; font-weight: 600; color: var(--text-1); }
.dev-desc {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.8;
  max-width: 420px;
}
.dev-tags { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.dev-tag {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 2px 10px;
  border-radius: 10px;
}
.dev-note { margin-top: 8px; font-size: 11.5px; color: var(--text-3); }
</style>
