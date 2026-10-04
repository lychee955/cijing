<script setup lang="ts">
import type {AnalysisNode} from "../../../shared/analysis";
defineProps<{node: AnalysisNode; nodes: AnalysisNode[]; original: string}>();
</script>
<template>
    <details class="analysis-node" :class="node.kind">
        <summary>
            <span class="role-label">{{ node.role }}</span>
            {{ node.quotes.map((q) => q.text).join(" … ") }}
        </summary>
        <p class="annotated-quote">
            <template v-for="(span, i) in node.spans" :key="i"
                ><span v-if="i"> … </span><mark>{{ original.slice(span.start, span.end) }}</mark></template
            >
        </p>
        <p>{{ node.explanation }}</p>
        <p v-if="node.target" class="subtle">修饰对象：{{ node.target }}</p>
        <AnalysisNode
            v-for="child in nodes.filter((n) => n.parentId === node.id)"
            :key="child.id"
            :node="child"
            :nodes="nodes"
            :original="original"
        />
    </details>
</template>
