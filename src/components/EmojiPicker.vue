<script setup>
// Emoji 选择器:常用 emoji 网格
const EMOJIS = [
  '🛠','⚙️','🖥','💾','📁','📂','🗂','📌','⭐','🚀','🔥','💡',
  '🧹','🧰','🔧','🔨','📦','🔒','🔑','🛡','🌐','📡','📝','📜',
  '📊','📈','🎨','🎬','🎵','📷','🕹','🎮','💾','💿','🖨','⌨️',
  '🤖','🧠','⚡','☀️','🌙','☁️','🌊','🍃','🍀','🌸','🍎','🍋',
  '🏠','🏢','🚗','✈️','🕐','📅','✅','❌','⚠️','💬','📮','🎁',
  '👨‍💻','🐱','🐶','🦊','🐧','🐋','🦋','🌟','✨','🎯','🧩','♟',
  '📞','📩','🗑','🔍','🔄','📥','📤','➕','⚡','🧪','🧲','🔱'
]
const emit = defineEmits(['select'])
</script>

<template>
  <div class="emoji-picker">
    <button v-for="e in EMOJIS" :key="e" type="button" class="emoji-cell" @click="emit('select', e)">
      {{ e }}
    </button>
  </div>
</template>

<style scoped>
.emoji-picker {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 2px;
  padding: 8px;
  border-radius: 12px;
  background: var(--bg-input);
}
.emoji-cell {
  height: 32px;
  border-radius: 7px;
  font-size: 17px;
  display: grid; place-items: center;
  transition: background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.emoji-cell:hover { background: var(--accent-soft); transform: scale(1.15); }
.emoji-cell:active { transform: scale(0.95); }
</style>
