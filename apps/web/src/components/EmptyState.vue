<script setup lang="ts">
import { Inbox } from "lucide-vue-next";

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <div class="empty">
    <div class="empty-icon">
      <slot name="icon"><Inbox :size="19" /></slot>
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>
