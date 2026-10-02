<script setup lang="ts">
import brand from '../../../shared/brand.json'
</script>
<template>
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" :rx="brand.icon.radius" :fill="brand.icon.background" />
    <polyline v-for="(stroke, i) in brand.icon.strokes" :key="i" :points="stroke.points.map(p => p.join(',')).join(' ')"
      fill="none" :stroke="stroke.accent ? brand.icon.accent : brand.icon.foreground" :stroke-width="stroke.width" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
