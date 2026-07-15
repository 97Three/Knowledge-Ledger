<script setup lang="ts">
import { AlertTriangle, RefreshCw } from "lucide-vue-next";

defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-box" role="alert">
    <AlertTriangle :size="18" aria-hidden="true" />
    <div>
      <strong>暂时无法读取数据</strong>
      <p>{{ error.message }}</p>
    </div>
    <button class="btn btn-sm" @click="$emit('retry')">
      <RefreshCw :size="13" /> 重试
    </button>
  </div>
</template>
