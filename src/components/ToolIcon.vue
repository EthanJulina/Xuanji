<script setup>
// 工具图标渲染:系统真实图标(dataURL)/ emoji / 本地图片 / 首字母占位
import { computed } from 'vue'
import { s, categoryById } from '../composables/store'

const props = defineProps({
  tool: { type: Object, required: true },
  size: { type: Number, default: 40 }
})

// 占位底色:按分类色或名称哈希生成的克制底色
const PLACE_COLORS = ['#4F8CFF', '#8C6FFF', '#34B3A0', '#E8A33D', '#E2669B', '#5FA7E0', '#7E6BE0']
const hashedColor = computed(() => {
  if (props.tool.categoryId) {
    const c = categoryById(props.tool.categoryId)
    if (c?.color) return c.color
  }
  let h = 0
  for (const ch of props.tool.name || '') h = (h * 31 + ch.codePointAt(0)) >>> 0
  return PLACE_COLORS[h % PLACE_COLORS.length]
})

const render = computed(() => {
  const icon = props.tool.icon
  if (!icon || icon === 'auto' || icon.kind === 'auto') {
    const url = s.icons[props.tool.id]
    if (url) return { type: 'img', url }
    return { type: 'letter' }
  }
  if (icon.kind === 'emoji') return { type: 'emoji', value: icon.value }
  if (icon.kind === 'img') return { type: 'img', url: icon.data }
  return { type: 'letter' }
})

const firstChar = computed(() => (props.tool.name || '?').trim().charAt(0).toUpperCase())
</script>

<template>
  <div class="tool-icon" :style="{ width: size + 'px', height: size + 'px', borderRadius: size * 0.28 + 'px' }">
    <img v-if="render.type === 'img'" :src="render.url" alt="" draggable="false" />
    <span v-else-if="render.type === 'emoji'" class="emoji" :style="{ fontSize: size * 0.55 + 'px' }">{{ render.value }}</span>
    <span v-else class="letter" :style="{ background: hashedColor + '2E', color: hashedColor, fontSize: size * 0.42 + 'px' }">{{ firstChar }}</span>
  </div>
</template>

<style scoped>
.tool-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: var(--bg-card);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--divider);
}
.tool-icon img { width: 74%; height: 74%; object-fit: contain; }
.emoji { line-height: 1; }
.letter { font-weight: 600; width: 100%; height: 100%; display: grid; place-items: center; }
</style>
