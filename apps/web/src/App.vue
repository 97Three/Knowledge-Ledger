<script setup lang="ts">
import zhCn from "element-plus/es/locale/lang/zh-cn";
import AppShell from "@/components/AppShell.vue";
import OnboardingWizard from "@/components/OnboardingWizard.vue";
</script>

<template>
  <el-config-provider :locale="zhCn">
    <AppShell />
    <OnboardingWizard />
  </el-config-provider>
</template>
