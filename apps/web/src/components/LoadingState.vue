<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next";

withDefaults(defineProps<{ label?: string }>(), { label: "正在读取账本状态" });
</script>

<template>
  <div class="loading" role="status">
    <LoaderCircle :size="16" aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>
