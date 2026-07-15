<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();

const LABELS: Record<string, string> = {
  accepted: "已执行",
  candidate: "待审核",
  deprecated: "已废弃",
  erased: "已擦除",
  needs_evidence: "待补证",
  published: "已发布",
  quarantined: "已隔离",
  rejected: "已拒绝",
  revoked: "已撤销",
  superseded: "历史版本",
  validating: "校验中",
  verified: "待发布",
  withdrawn: "已撤回",
};

const label = computed(() => LABELS[props.status] ?? props.status);
</script>

<template>
  <span class="badge" :class="`badge-${status}`">{{ label }}</span>
</template>
