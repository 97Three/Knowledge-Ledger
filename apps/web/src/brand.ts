/**
 * 品牌与协议标识的唯一来源。
 *
 * 产品名、协议名、界面可见的版本号都从这里取；页面里不要再写死字符串。
 * 协议名（NIAN）暂不改动：线上路径 /nian/0.1、请求头 NIAN-Version、
 * nianVersion 字段都由后端定义，这里只负责“显示”。
 * 将来后端改名时，改这一处常量即可，业务代码不需要动。
 */
export const BRAND = {
  name: "Knowledge Ledger",
  nameZh: "知谱",
  shortName: "Ledger",
  tagline: "让每一条知识都有据可查",
  description:
    "候选、审核、发布、引用与反馈记在同一本账上：每一次修订都不可覆盖，每一条引用都能回到它的出处。",
  protocol: {
    name: "NIAN",
    version: "0.1",
    /** 界面展示用，例如 Agent 接入页的协议卡片标题 */
    label: "NIAN / 0.1",
  },
  workspace: {
    name: "Acme 客服知识域",
    slug: "support-core",
    environment: "LOCAL",
  },
} as const;

export const PROTOCOL_LABEL = `${BRAND.protocol.name} / ${BRAND.protocol.version}`;
