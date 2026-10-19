<script setup>
import { watch, nextTick, onBeforeUnmount, ref } from 'vue'
import { security, turnstileScript } from '../utils/http.js'
import { t } from '../composables/useTheme.js'
const mount = ref(null)
const failure = ref('')
let widget
let generation = 0
const remove = () => { if (widget !== undefined && window.turnstile) window.turnstile.remove(widget); widget = undefined }
async function render() {
  const run = ++generation
  remove()
  failure.value = ''
  const challenge = security.challenge
  if (!challenge) return
  try {
    await nextTick()
    await turnstileScript()
    if (run !== generation || !mount.value) return
    if (!challenge.siteKey) throw new Error('Missing Turnstile site key')
    widget = window.turnstile.render(mount.value, {
      sitekey: challenge.siteKey, theme: 'auto',
      callback: token => challenge.resolve(token),
      'error-callback': () => { failure.value = t('人机验证失败，请重试。', 'Verification failed. Please try again.'); return true },
      'expired-callback': () => { failure.value = t('验证已过期，请重试。', 'Verification expired. Please try again.') }
    })
  } catch (e) { failure.value = e.message }
}
watch(() => security.challenge, render)
onBeforeUnmount(() => { ++generation; remove() })
</script>
<template>
  <div v-if="security.challenge" class="overlay" role="dialog" aria-modal="true" :aria-label="t('安全验证', 'Security verification')">
    <section class="dialog"><span class="eyebrow">CLOUDFLARE TURNSTILE</span><h2>{{ t('安全验证', 'Security verification') }}</h2><p>{{ t('完成验证后即可查看服务器状态。', 'Complete verification to view server status.') }}</p><div ref="mount"></div><p v-if="failure" role="alert" class="error-text">{{ failure }}</p><button v-if="failure" @click="render">{{ t('重试验证', 'Try again') }}</button></section>
  </div>
</template>
