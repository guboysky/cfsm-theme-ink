<script setup>
import { Activity, Server, LayoutGrid, List, Search, ArrowUpRight, ArrowDownLeft, ArrowLeft, Settings2, Sun, Moon, ChevronRight, Check, CircleHelp, Radio, Layers, X, ExternalLink, HardDrive, Cpu, MemoryStick, SlidersHorizontal, Network, Globe, Clock, AlertTriangle, Expand, Maximize2, Minimize2, CalendarDays } from '@lucide/vue'
defineProps({ name: String, size: { type: Number, default: 16 } })
const icons = { Activity, Server, LayoutGrid, List, Search, ArrowUpRight, ArrowDownLeft, ArrowLeft, Settings2, Sun, Moon, ChevronRight, Check, CircleHelp, Radio, Layers, X, ExternalLink, HardDrive, Cpu, MemoryStick, SlidersHorizontal, Network, Globe, Clock, AlertTriangle, Expand, Maximize2, Minimize2, CalendarDays }
</script>
<template><component :is="icons[name] || Activity" :size="size" :stroke-width="1.65" aria-hidden="true" /></template>
