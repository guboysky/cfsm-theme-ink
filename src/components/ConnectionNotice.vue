<script setup>
import { t } from '../composables/useTheme.js'
defineProps({ states: Object })
defineEmits(['continue', 'pause', 'reconnect'])
</script>
<template>
  <div v-if="Object.values(states).includes('expired')" class="notice" role="status">
    <span>{{ t('实时连接已达到站点设置的时长，是否继续？', 'The live session reached its time limit. Continue?') }}</span>
    <div class="actions"><button class="primary" @click="$emit('continue')">{{ t('继续实时更新', 'Continue live updates') }}</button><button @click="$emit('pause')">{{ t('保持暂停', 'Keep paused') }}</button></div>
  </div>
  <div v-else-if="Object.values(states).some(s => ['failed', 'denied', 'invalid-message'].includes(s))" class="notice" role="alert">
    <span>{{ t('实时连接不可用，当前显示最后收到的数据。', 'Live connection unavailable. Showing the last received data.') }}</span><button @click="$emit('reconnect')">{{ t('重新连接', 'Reconnect') }}</button>
  </div>
  <div v-else-if="Object.values(states).some(s => ['hidden', 'paused'].includes(s))" class="notice"><span>{{ t('实时更新已暂停。', 'Live updates are paused.') }}</span><button @click="$emit('continue')">{{ t('继续', 'Continue') }}</button></div>
</template>
