import { createApp } from "vue";
import { createPinia } from "pinia";
import {
  ElButton,
  ElCheckbox,
  ElCollapse,
  ElCollapseItem,
  ElConfigProvider,
  ElDialog,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTooltip,
  ElUpload,
} from "element-plus";
import "element-plus/dist/index.css";
import "@/styles/index.css";
import App from "./App.vue";
import { router } from "./router";

/**
 * 只注册实际用到的 Element Plus 组件，避免把整个组件库打进首屏。
 * 新增 el-* 组件时，记得在这里补一行。
 */
const ELEMENT_COMPONENTS = [
  ElButton,
  ElCheckbox,
  ElCollapse,
  ElCollapseItem,
  ElConfigProvider,
  ElDialog,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTooltip,
  ElUpload,
];

const app = createApp(App);
for (const component of ELEMENT_COMPONENTS) app.use(component);
app.use(createPinia());
app.use(router);
app.mount("#app");
