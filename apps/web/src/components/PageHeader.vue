<script setup lang="ts">
defineProps<{
  eyebrow?: string;
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <header class="page-head">
    <div>
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
