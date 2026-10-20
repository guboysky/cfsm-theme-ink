<script setup>
import { computed, ref, watch } from 'vue'
import { t } from '../composables/useTheme.js'
import { object, available, reportText as text, parseReports, embeddedReports, factorState, mediaState, maskedIp } from '../utils/ipQuality.js'
import Icon from './Icon.vue'

const props = defineProps({ server: { type: Object, required: true } })
const section = ref('basic'), imported = ref(null), selected = ref(0), error = ref(''), fileInput = ref(null), importing = ref(false)
const tabs = computed(() => [
  ['basic', t('基本信息', 'Identity'), 'Network'], ['scores', t('风控评分', 'Risk scores'), 'ShieldCheck'],
  ['factors', t('风险因子', 'Risk factors'), 'SlidersHorizontal'], ['media', t('流媒体与 AI', 'Streaming & AI'), 'Monitor'],
  ['mail', t('邮件与黑名单', 'Mail & blocklists'), 'Mail'], ['raw', t('原始归档', 'Raw report'), 'FileJson']
])
const supplied = computed(() => {
  const value = embeddedReports(props.server)
  if (value == null) return { reports: [], invalid: false }
  try { return { reports: parseReports(value), invalid: false } } catch { return { reports: [], invalid: true } }
})
const reports = computed(() => imported.value || supplied.value.reports)
const report = computed(() => reports.value[selected.value] || reports.value[0])
const info = computed(() => object(report.value?.Info))
const factor = computed(() => object(report.value?.Factor))
const providers = computed(() => [...new Set(Object.values(factor.value).flatMap(row => Object.keys(object(row))))])
const media = computed(() => object(report.value?.Media))
const mail = computed(() => object(report.value?.Mail))
const blacklist = computed(() => object(mail.value.DNSBlacklist))
const basics = computed(() => [
  [t('IP 地址', 'IP address'), maskedIp(report.value?.Head.IP)],
  [t('国家 / 地区', 'Country / region'), text(object(info.value.Region).Name)],
  [t('城市', 'City'), text(object(info.value.City).Name)],
  [t('ASN', 'ASN'), text(info.value.ASN)],
  [t('所属组织', 'Organization'), text(info.value.Organization)],
  [t('时区', 'Timezone'), text(info.value.TimeZone)],
  [t('地理归属判断', 'Geolocation classification'), text(info.value.Type)],
  [t('检测器版本', 'Collector version'), text(report.value?.Head.Version)]
])
const labels = computed(() => ({ CountryCode: t('国家代码', 'Country code'), Proxy: t('代理', 'Proxy'), Tor: 'Tor', VPN: 'VPN', Server: t('机房 / 托管', 'Hosting'), Abuser: t('滥用记录', 'Abuse'), Robot: t('机器人', 'Bot') }))
watch(() => `${props.server._base}:${props.server.id}`, () => { imported.value = null; selected.value = 0; error.value = ''; section.value = 'basic' })
watch(reports, () => { selected.value = 0 })
function changeTab(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const index = tabs.value.findIndex(tab => tab[0] === section.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.value.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.value.length) % tabs.value.length
  section.value = tabs.value[next][0]
  event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus()
}
async function importReport(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  error.value = ''; importing.value = true
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('size')
    const parsed = parseReports(JSON.parse(await file.text()))
    imported.value = parsed; selected.value = 0; section.value = 'basic'
  } catch (e) {
    error.value = e.message === 'size' ? t('报告不能超过 2 MB。', 'Reports must be under 2 MB.') : t('报告格式不支持，请选择 IPQuality JSON 报告或报告数组。', 'Choose an IPQuality JSON report or an array of reports.')
  } finally { importing.value = false }
}
const stateLabel = value => ({ detected: t('检出', 'Detected'), clear: t('未检出', 'Not detected'), unknown: t('无数据', 'No data') })[factorState(value)]
const mediaLabel = value => ({ available: t('检测通过', 'Passed'), blocked: t('受限', 'Restricted'), partial: t('部分支持', 'Partial'), unknown: t('未确认', 'Unconfirmed') })[mediaState(value)]
</script>

<template>
  <div class="ip-quality">
    <header class="ipq-heading">
      <div><h3><Icon name="ShieldCheck" :size="17" />{{ t('IP 质量档案', 'IP quality archive') }}</h3><p>{{ t('定期检测报告 · 查看不会触发节点检测', 'Archived checks · Viewing does not run a probe') }}</p></div>
      <div class="ipq-actions"><button v-if="imported" @click="imported = null; error = ''">{{ t('返回节点报告', 'Use node reports') }}</button><button :disabled="importing" @click="fileInput.click()"><Icon name="Upload" :size="14" />{{ t('导入报告', 'Import report') }}</button><input ref="fileInput" class="ipq-file" type="file" accept=".json,application/json" :aria-label="t('导入 IPQuality JSON 报告', 'Import IPQuality JSON report')" @change="importReport" /></div>
    </header>
    <p v-if="error" class="notice error-text" role="alert">{{ error }}</p>
    <p v-if="supplied.invalid && !imported" class="notice error-text" role="alert">{{ t('节点报告格式无效，无法展示检测结果。', 'The node report has an unsupported format.') }}</p>
    <template v-if="report">
      <div class="ipq-archive-bar"><label>{{ t('检测归档', 'Archive') }}<select v-model="selected" :aria-label="t('选择检测归档', 'Select archive')"><option v-for="(item, index) in reports" :key="index" :value="index">{{ text(item.Head.Time) }} · {{ maskedIp(item.Head.IP) }}</option></select></label><span v-if="imported">{{ t('本地预览 · 仅本次弹窗有效，未上传', 'Local preview · Not uploaded; cleared when closed') }}</span><span v-else>{{ t('节点提供的归档', 'Archive supplied by node') }}</span></div>
      <div class="ipq-tabs" role="tablist" :aria-label="t('IP 质量信息分类', 'IP quality sections')" @keydown="changeTab"><button v-for="[key, label, icon] in tabs" :id="`ipq-${key}-tab`" :key="key" role="tab" :aria-selected="section === key" aria-controls="ipq-content" :tabindex="section === key ? 0 : -1" @click="section = key"><Icon :name="icon" :size="14" />{{ label }}</button></div>
      <div id="ipq-content" role="tabpanel" :aria-labelledby="`ipq-${section}-tab`">
        <template v-if="section === 'basic'">
          <section class="ipq-panel"><h4>{{ t('IP 身份与归属地信息', 'IP identity & location') }}</h4><dl class="ipq-facts"><div v-for="[label, value] in basics" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div></dl></section>
          <div class="ipq-two-columns"><section v-for="[key, title] in [['Usage', t('各数据库使用类型', 'Usage type by source')], ['Company', t('各数据库机构类型', 'Company type by source')]]" :key="key" class="ipq-panel"><h4>{{ title }}</h4><dl v-if="Object.keys(object(report.Type?.[key])).length" class="ipq-values"><div v-for="(value, provider) in object(report.Type?.[key])" :key="provider"><dt>{{ provider }}</dt><dd>{{ text(value) }}</dd></div></dl><p v-else class="ipq-missing">{{ t('暂无类型数据', 'No classification data') }}</p></section></div>
        </template>
        <template v-else-if="section === 'scores'"><section class="ipq-panel"><h4>{{ t('各数据库风控评分', 'Risk scores by source') }}</h4><div v-if="Object.keys(object(report.Score)).length" class="ipq-score-grid"><div v-for="(value, provider) in object(report.Score)" :key="provider" class="ipq-score"><span>{{ provider }}</span><strong>{{ text(value) }}</strong><small>{{ available(value) ? t('来源原始分值', 'Original source score') : t('未返回评分', 'No score returned') }}</small></div></div><p v-else class="ipq-missing">{{ t('暂无风控评分', 'No risk scores') }}</p></section><p class="ipq-note">{{ t('各数据库评分口径不同，保留原始分值，不合并为“纯净度”。', 'Scores use different definitions and are not combined into a purity score.') }}</p></template>
        <section v-else-if="section === 'factors'" class="ipq-panel"><h4>{{ t('风险因子检测矩阵', 'Risk factor matrix') }}</h4><div v-if="providers.length" class="ipq-table-wrap"><table class="ipq-matrix"><thead><tr><th>{{ t('风险因子', 'Factor') }}</th><th v-for="provider in providers" :key="provider">{{ provider }}</th></tr></thead><tbody><tr v-for="(row, key) in factor" :key="key"><th>{{ labels[key] || key }}</th><td v-for="provider in providers" :key="provider"><span v-if="key === 'CountryCode'">{{ text(object(row)[provider]) }}</span><span v-else class="ipq-badge" :class="factorState(object(row)[provider])">{{ stateLabel(object(row)[provider]) }}</span></td></tr></tbody></table></div><p v-else class="ipq-missing">{{ t('暂无风险因子数据', 'No risk factors') }}</p></section>
        <template v-else-if="section === 'media'"><section class="ipq-panel"><h4>{{ t('流媒体与 AI 平台检测', 'Streaming & AI checks') }}</h4><div v-if="Object.keys(media).length" class="ipq-media-grid"><article v-for="(item, name) in media" :key="name" class="ipq-service"><header><strong>{{ name }}</strong><span v-if="available(item?.Region)" class="ipq-region">{{ text(item.Region) }}</span></header><span class="ipq-badge" :class="mediaState(item?.Status)">{{ mediaLabel(item?.Status) }}</span><small>{{ t('原始结果', 'Source result') }}: {{ text(item?.Status) }}<template v-if="available(item?.Type)"> · {{ text(item.Type) }}</template></small></article></div><p v-else class="ipq-missing">{{ t('暂无平台检测数据', 'No platform checks') }}</p></section><p class="ipq-note">{{ t('检测结果对应归档时的出口与访问条件，不保证账号登录、付费或实际播放。', 'Results reflect the tested exit and time; login, payment and playback are not guaranteed.') }}</p></template>
        <template v-else-if="section === 'mail'"><div class="ipq-two-columns"><section class="ipq-panel"><h4>{{ t('邮件服务连通性', 'Mail connectivity') }}</h4><dl v-if="Object.keys(mail).some(key => key !== 'DNSBlacklist')" class="ipq-values"><div v-for="(value, key) in Object.fromEntries(Object.entries(mail).filter(([key]) => key !== 'DNSBlacklist'))" :key="key"><dt>{{ key === 'Port25' ? t('出站 25 端口', 'Outbound port 25') : key }}</dt><dd><span class="ipq-badge" :class="factorState(value) === 'detected' ? 'available' : factorState(value) === 'clear' ? 'blocked' : 'unknown'">{{ factorState(value) === 'detected' ? t('可连接', 'Reachable') : factorState(value) === 'clear' ? t('不可连接', 'Unreachable') : t('无数据', 'No data') }}</span></dd></div></dl><p v-else class="ipq-missing">{{ t('暂无邮件检测数据', 'No mail checks') }}</p></section><section class="ipq-panel"><h4>{{ t('DNS 黑名单', 'DNS blocklists') }}</h4><dl v-if="Object.keys(blacklist).length" class="ipq-values"><div v-for="[key, label] in [['Total', t('检测总数', 'Total')], ['Clean', t('未命中', 'Clean')], ['Marked', t('标记', 'Marked')], ['Blacklisted', t('黑名单命中', 'Blacklisted')]]" :key="key"><dt>{{ label }}</dt><dd>{{ text(blacklist[key]) }}</dd></div></dl><p v-else class="ipq-missing">{{ t('暂无黑名单数据', 'No blocklist data') }}</p></section></div><p class="ipq-note">{{ t('连通性检测不等于邮件可以投递到收件箱。', 'Connectivity does not guarantee inbox delivery.') }}</p></template>
        <section v-else class="ipq-panel"><h4>{{ t('原始 JSON 归档', 'Original JSON archive') }}</h4><p class="ipq-note">{{ t('原始归档可能包含完整 IP 等信息。', 'Raw archives may include the complete IP address.') }}</p><pre class="ipq-raw" tabindex="0">{{ JSON.stringify(report, null, 2) }}</pre></section>
      </div>
    </template>
    <section v-else class="ipq-empty"><div class="ipq-empty-icon"><Icon name="ShieldCheck" :size="28" /></div><h3>{{ t('尚无 IP 质量报告', 'No IP quality report yet') }}</h3><p>{{ t('此节点尚未接入检测归档。可导入该节点的 IPQuality JSON 报告查看。', 'No archive is connected. Import this node’s IPQuality JSON report to view it.') }}</p><span class="ipq-badge unknown">{{ t('未检测', 'Not tested') }}</span><small>{{ t('导入文件只在本次弹窗内查看，不上传或保存。', 'Imported files stay in this dialog and are not uploaded or saved.') }}</small></section>
  </div>
</template>

<style scoped>
.ip-quality{font-size:12px;min-width:0}.ipq-heading,.ipq-actions,.ipq-archive-bar,.ipq-service header{display:flex;align-items:center;justify-content:space-between;gap:12px}.ipq-heading{margin-bottom:16px}.ipq-heading h3{display:flex;align-items:center;gap:8px;font-size:14px}.ipq-heading h3 svg{color:var(--green)}.ipq-heading p,.ipq-note{color:var(--muted);font-size:11px;line-height:1.7;margin:6px 0 0}.ipq-actions{flex-shrink:0;gap:6px}.ipq-actions button{display:flex;align-items:center;gap:6px;font-size:11px;padding:7px 10px}.ipq-file{display:none}.ipq-archive-bar{padding:10px 12px;background:var(--soft);border:1px solid var(--line);border-radius:4px;margin-bottom:12px;flex-wrap:wrap;font-size:11px;color:var(--muted)}.ipq-archive-bar label{display:flex;align-items:center;gap:10px;min-width:0}.ipq-archive-bar select{font-size:11px;max-width:100%;min-width:0}.ipq-tabs{display:flex;overflow-x:auto;border-bottom:1px solid var(--line);gap:8px;margin-bottom:16px}.ipq-tabs button{display:flex;align-items:center;gap:6px;flex-shrink:0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--muted);padding:10px 12px;font-size:12px}.ipq-tabs button[aria-selected=true]{color:var(--green);border-bottom-color:var(--green)}.ipq-panel{padding:16px;border:1px solid var(--line);border-radius:5px;margin-bottom:14px;min-width:0}.ipq-panel h4{font-size:12px;margin:0 0 14px}.ipq-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0}.ipq-facts>div{background:var(--soft);padding:12px;border-radius:4px;min-width:0}.ipq-facts dt{color:var(--muted);font-size:11px}.ipq-facts dd{margin:6px 0 0;font-weight:600;overflow-wrap:anywhere}.ipq-two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.ipq-values{margin:0}.ipq-values>div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.ipq-values>div:last-child{border-bottom:0}.ipq-values dt{color:var(--muted)}.ipq-values dd{margin:0;text-align:right;overflow-wrap:anywhere}.ipq-score-grid,.ipq-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ipq-score,.ipq-service{background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:14px;min-width:0}.ipq-score strong{display:block;font-size:25px;margin:10px 0}.ipq-score small,.ipq-service small{color:var(--muted);display:block;font-size:10px;margin-top:8px;overflow-wrap:anywhere}.ipq-service header{margin-bottom:16px}.ipq-service strong{overflow-wrap:anywhere}.ipq-region{font-size:10px;color:var(--green);background:var(--panel);padding:2px 5px;border-radius:3px}.ipq-badge{display:inline-flex;font-size:11px;line-height:1.6;padding:2px 7px;border-radius:3px;white-space:nowrap}.ipq-badge.clear,.ipq-badge.available{color:var(--green);background:color-mix(in srgb,var(--green) 10%,transparent)}.ipq-badge.detected,.ipq-badge.blocked{color:#bf5362;background:color-mix(in srgb,#bf5362 10%,transparent)}.ipq-badge.unknown{color:var(--muted);background:var(--soft)}.ipq-badge.partial{color:#a47a2d;background:color-mix(in srgb,#a47a2d 12%,transparent)}.ipq-table-wrap{overflow:auto}.ipq-matrix{width:100%;font-size:11px;border-collapse:collapse}.ipq-matrix th,.ipq-matrix td{padding:12px 10px;white-space:nowrap;text-align:center;border-bottom:1px solid var(--line)}.ipq-matrix th:first-child{text-align:left}.ipq-matrix tbody th{font-weight:500}.ipq-missing{color:var(--muted);padding:24px 0;text-align:center}.ipq-empty{min-height:280px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;border:1px dashed var(--line);border-radius:5px;padding:24px;gap:12px}.ipq-empty-icon{padding:14px;border-radius:50%;background:var(--soft);color:var(--muted)}.ipq-empty h3{font-size:15px}.ipq-empty p{font-size:12px;max-width:420px;color:var(--muted);line-height:1.8}.ipq-empty small{font-size:10px;color:var(--muted)}.ipq-raw{overflow:auto;max-height:450px;padding:14px;margin-top:10px;background:var(--soft);font-size:11px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:700px){.ipq-heading{align-items:flex-start;flex-wrap:wrap}.ipq-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.ipq-two-columns{grid-template-columns:1fr;gap:0}.ipq-score-grid,.ipq-media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ipq-panel{padding:12px}.ipq-tabs{gap:0}.ipq-tabs button{font-size:11px;padding:10px}.ipq-archive-bar label{flex-wrap:wrap;gap:6px;width:100%}.ipq-archive-bar select{width:100%}}
</style>
