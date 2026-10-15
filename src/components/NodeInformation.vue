<script setup>
import { computed } from 'vue'
import { nodeNotes, inferredProvider, validRegion, regionName } from '../utils/display.js'
import { t, language } from '../composables/useTheme.js'
import Icon from './Icon.vue'
const props = defineProps({ server: Object, site: Object, notesOnly: Boolean })
const notes = computed(() => nodeNotes(props.server))
const provider = computed(() => inferredProvider(props.server))
</script>
<template><div class="node-information" :class="{ 'notes-only': notesOnly }"><span v-if="!notesOnly && provider" class="info-chip provider-chip" :title="t('providerHint')"><Icon name="server" :size="13"/>{{ provider }}</span><span v-if="!notesOnly && validRegion(server.region)" class="info-chip region-chip"><img :src="`${site.base}/flags/${server.region.toLowerCase()}.svg`" alt="">{{ regionName(server.region, language) }}</span><span v-for="(note, index) in notes.slice(0, 4)" :key="index" class="info-chip note-chip" :title="note">{{ note }}</span><span v-if="notes.length > 4" class="info-chip note-chip" :title="notes.join(' · ')">+{{ notes.length - 4 }}</span></div></template>
