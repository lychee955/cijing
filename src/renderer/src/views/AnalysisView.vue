<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAnalysisStore } from '../stores/analysis'
import AnalysisNode from '../components/AnalysisNode.vue'
const emit = defineEmits<{ settings: []; lookup: [word: string] }>()
const analysis = useAnalysisStore(), now = ref(Date.now()), clearConfirm = ref(false), deleteId = ref('')
const words = computed(() => (analysis.input.match(/[a-zA-Z]+(?:['’\-][a-zA-Z]+)*/g) ?? []).length)
const valid = computed(() => words.value > 0 && words.value <= 300 && analysis.input.length <= 6000)
const elapsed = computed(() => Math.max(0, Math.floor((now.value - analysis.startedAt) / 1000)))
const translation = computed(() => analysis.record?.result.sentences.map(sentence => sentence.translation).join('') ?? '')
let timer: ReturnType<typeof setInterval>
onMounted(() => { void analysis.refresh(); void analysis.loadHistory(); timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(timer))
function submit(event: KeyboardEvent): void { if (!event.isComposing && !event.repeat && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (valid.value) void analysis.run() } }
</script>
<template>
  <section class="analysis-page">
    <div class="eyebrow">从主干读懂句子</div><h1>句子分析</h1>
    <div class="analysis-toolbar"><label>当前 AI 配置<select aria-label="当前 AI 配置" :value="analysis.configuration.activeId ?? ''" @change="analysis.select(($event.target as HTMLSelectElement).value)"><option disabled value="">请选择配置</option><option v-for="p in analysis.configuration.profiles" :key="p.id" :value="p.id">{{ p.name }} · {{ p.model }}</option></select></label><button @click="emit('settings')">AI 服务设置</button></div>
    <p v-if="!analysis.active" class="notice">请先在设置中配置 AI 服务。句子分析无需墨墨 Token。</p>
    <label class="visually-hidden" for="analysis-input">英文句子或短段落</label><textarea id="analysis-input" v-model="analysis.input" rows="5" placeholder="输入英文句子或短段落…" :disabled="analysis.busy" @keydown="submit" />
    <div class="input-hint"><span>Ctrl / ⌘ + Enter 分析</span><span :class="{ danger: !valid && analysis.input.length > 0 }">{{ words }} / 300 单词 · {{ analysis.input.length }} / 6,000 字符</span></div>
    <div class="actions"><button class="primary" :disabled="!valid || !analysis.active || !analysis.active.hasKey || analysis.busy" @click="analysis.run()">{{ analysis.busy ? '正在分析…' : '分析句子' }}</button><button v-if="analysis.busy" @click="analysis.cancel()">取消分析</button><button v-else-if="analysis.record" :disabled="!valid || !analysis.active" @click="analysis.run(true)">重新分析</button><button v-else-if="analysis.message" :disabled="!valid || !analysis.active" @click="analysis.run(true)">重试分析</button></div>
    <p v-if="analysis.busy" class="notice" role="status">正在等待模型分析 · 已用 {{ elapsed }} 秒。完成后统一展示结果。</p>
    <p v-if="analysis.message" class="notice error ai-error-message" role="alert">{{ analysis.message }}</p>
    <section v-if="analysis.record" class="analysis-result" aria-label="分析结果">
      <p class="subtle">{{ analysis.reused ? '复用已完成分析 · ' : '' }}{{ new Date(analysis.record.createdAt).toLocaleString() }} · {{ analysis.record.source.name }} · {{ analysis.record.model }} · 生成调用 {{ analysis.record.attempts }} 次<br />用量：输入 {{ analysis.record.usage?.inputTokens ?? '未知' }} / 输出 {{ analysis.record.usage?.outputTokens ?? '未知' }}</p>
      <p v-if="analysis.record.result.degraded" class="notice">部分标注未能定位，已保留有效讲解。此结果不会自动复用。</p>
      <p class="notice analysis-translation" aria-label="全文翻译">{{ translation }}</p>
      <article v-for="(sentence, i) in analysis.record.result.sentences" :key="i" class="sentence-card">
        <div class="subtle">第 {{ i + 1 }} 句</div><h2 class="sentence-original">{{ sentence.original }}</h2><p>{{ sentence.translation }}</p>
        <div class="backbone"><strong>句子主干</strong><p>{{ sentence.backbone }}</p></div>
        <details><summary>成分与从句（{{ sentence.nodes.length }}）</summary><AnalysisNode v-for="node in sentence.nodes.filter(n => n.parentId === null)" :key="node.id" :node="node" :nodes="sentence.nodes" :original="sentence.original" /><p v-if="!sentence.nodes.length" class="subtle">没有可定位的结构标注。</p></details>
        <details v-if="sentence.grammar.length"><summary>语法要点</summary><ul><li v-for="(point, j) in sentence.grammar" :key="j">{{ point }}</li></ul></details>
        <details v-if="sentence.unlocated.length"><summary>未定位的成分讲解</summary><p class="subtle">以下讲解保留供参考，不显示原文高亮。</p><p v-for="(item, j) in sentence.unlocated" :key="j"><strong>{{ item.role }}：</strong>{{ item.explanation }}</p></details>
        <details v-if="sentence.vocabulary.length"><summary>重点词汇</summary><article v-for="(word, j) in sentence.vocabulary" :key="j" class="analysis-vocabulary"><div><strong>{{ word.word }}</strong><p>{{ word.meaning }}</p><span class="subtle">原形建议：{{ word.lemma }}（查词后确认词条）</span></div><div class="actions"><button @click="emit('lookup', word.word.toLowerCase())">查词 {{ word.word.toLowerCase() }}</button><button v-if="word.lemma !== word.word" @click="emit('lookup', word.lemma.toLowerCase())">查原形 {{ word.lemma.toLowerCase() }}</button></div></article></details>
        <details v-if="sentence.notes.length"><summary>歧义、指代与原文错误</summary><ul><li v-for="(note, j) in sentence.notes" :key="j">{{ note }}</li></ul></details>
      </article>
    </section>
    <details class="analysis-history"><summary>分析历史（{{ analysis.total }}）</summary>
      <div class="actions"><button @click="analysis.loadHistory()">刷新分析历史</button><button class="danger" :disabled="!analysis.total" @click="clearConfirm = true">清空分析历史</button></div>
      <p v-if="clearConfirm" class="notice">清空全部分析历史？<button class="danger" @click="analysis.remove(); clearConfirm = false">确认清空</button><button @click="clearConfirm = false">保留</button></p>
      <article v-for="item in analysis.history" :key="item.id" class="history-card"><p class="history-message">{{ item.text }}</p><p class="subtle">{{ item.source.name }} · {{ item.model }} · {{ new Date(item.createdAt).toLocaleString() }}</p><div class="actions"><button @click="analysis.open(item.id)">查看分析</button><button class="danger" @click="deleteId = item.id">删除分析</button></div><p v-if="deleteId === item.id" class="notice">删除此分析？<button class="danger" @click="analysis.remove(item.id); deleteId = ''">确认删除分析</button><button @click="deleteId = ''">保留</button></p></article>
      <div class="pagination"><button :disabled="analysis.offset === 0" @click="analysis.offset -= 20; analysis.loadHistory()">上一页</button><span>{{ analysis.total ? analysis.offset + 1 : 0 }} / {{ analysis.total }}</span><button :disabled="analysis.offset + 20 >= analysis.total" @click="analysis.offset += 20; analysis.loadHistory()">下一页</button></div>
    </details>
  </section>
</template>
