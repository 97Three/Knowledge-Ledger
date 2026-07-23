/**
 * 演示数据：通过真实 API 把一本“有内容的知识账本”写进本地节点。
 *
 * 每个条目都走完整闭环：候选 → 独立审核 → 发布；随后对其中一部分记录
 * 引用、使用与反馈，让工作台、审核中心、发布决策、使用证据四个页面都有真实数据。
 *
 * 用法（在 apps/web 下）：
 *   NIAN_WEB_ORIGIN=http://127.0.0.1:33005 pnpm seed:ledger-demo
 *
 * 幂等：已存在同名知识的会被跳过（按候选标题对比），可重复执行。
 */
import {
  applyGovernanceAction,
  createContribution,
  getContributions,
  recordKnowledgeOutcome,
  reviewContribution,
  searchKnowledge,
} from "../src/api/client";
import { buildKnowledgeContribution } from "../src/api/knowledge";

const origin = process.env.NIAN_WEB_ORIGIN ?? "http://127.0.0.1:33005";
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? new URL(input, origin) : input;
  return nativeFetch(target, init);
}) as typeof fetch;

const SUPPORT = "https://knowledge.local/spaces/support-core";
const BILLING = "https://knowledge.local/spaces/billing-policy";
const OPS = "https://knowledge.local/spaces/ops-runbook";

type SeedState = "published" | "verified" | "candidate" | "needs_evidence" | "rejected";

interface Seed {
  title: string;
  summary: string;
  assetType: "procedure" | "source_document";
  space: string;
  labels: string[];
  body: string;
  state: SeedState;
}

const SEEDS: Seed[] = [
  {
    title: "退款工单的升级与转派规则",
    summary: "明确什么情况下退款工单必须升级到二线，以及转派时必填的信息。",
    assetType: "procedure",
    space: SUPPORT,
    labels: ["refund", "escalation", "support-core"],
    state: "published",
    body: `## 适用场景
客户对退款金额、到账时间或退款被拒提出异议的工单。

## 升级条件（满足任一即升级）
1. 单笔退款金额 ≥ 5000 元。
2. 同一客户 30 天内第 3 次退款申请。
3. 客户明确提到投诉、监管或媒体。

## 转派时必须填写
- 订单号与支付流水号
- 已核实的事实与时间点
- 一线已给出的话术与客户反应

## 边界
本流程不覆盖跨境订单的关税部分，参见《跨境订单退货的关税处理说明》。`,
  },
  {
    title: "发票作废与重开的标准流程",
    summary: "发票开错、抬头变更或金额调整时的作废与重开操作顺序。",
    assetType: "procedure",
    space: BILLING,
    labels: ["invoice", "billing", "procedure"],
    state: "published",
    body: `## 前置条件
确认原发票未被客户用于抵扣；已抵扣的必须走红冲，不能作废。

## 步骤
1. 在开票系统发起作废申请，记录申请人。
2. 财务复核额度与税号。
3. 重开时保持订单号一致，仅调整抬头或金额。
4. 把新发票号回填到工单。

## 失效条件
跨月发票不适用本流程，必须走红冲。`,
  },
  {
    title: "企业客户 SLA 违约赔付口径",
    summary: "SLA 未达成时的赔付上限、计算口径与对外解释边界。",
    assetType: "source_document",
    space: BILLING,
    labels: ["sla", "enterprise", "policy"],
    state: "published",
    body: `## 计算口径
按自然月统计；月度可用性低于 99.9% 触发赔付。

## 赔付上限
- 99.0% – 99.9%：当月服务费的 10%
- 95.0% – 99.0%：当月服务费的 30%
- 低于 95.0%：当月服务费的 50%

## 对外解释
只陈述已核实的故障时段与影响面，不对未定责的原因做归因。

## 例外
客户侧自身网络、未按公告执行的变更窗口不计入。`,
  },
  {
    title: "会员等级权益变更通知模板",
    summary: "等级权益调整时的客户通知模板与必须披露的三项内容。",
    assetType: "procedure",
    space: SUPPORT,
    labels: ["membership", "notification", "template"],
    state: "published",
    body: `## 必须披露
1. 生效时间
2. 受影响的具体权益
3. 客户可选择的操作与截止时间

## 模板要点
先讲客户会受什么影响，再讲原因；不使用“优化”“升级”这类模糊词冲淡减损。

## 期限
权益下调类通知必须提前 30 天发出，并在应用内二次提示。`,
  },
  {
    title: "跨境订单退货的关税处理说明",
    summary: "跨境退货时已缴关税的处理方式、凭证要求与时效。",
    assetType: "source_document",
    space: SUPPORT,
    labels: ["cross-border", "refund", "tariff"],
    state: "published",
    body: `## 原则
已缴纳的进口关税原则上不退还，除非海关出具退运证明。

## 需要的凭证
- 海关退运证明
- 原报关单
- 客户退货物流签收记录

## 时效
凭证齐全后 15 个工作日内提交申请，超期海关不再受理。

## 对外口径
不得承诺“关税一定可退”，只能说明需要凭证并等待审批。`,
  },
  {
    title: "支付失败重试与人工补单流程",
    summary: "支付失败后的重试次数、间隔与人工补单的审批要求。",
    assetType: "procedure",
    space: BILLING,
    labels: ["payment", "retry", "billing"],
    state: "published",
    body: `## 自动重试
同一订单最多自动重试 3 次，间隔为 10 分钟、1 小时、6 小时。

## 人工补单
需满足：客户主动确认 + 支付渠道可查询到授权记录 + 财务审批。

## 禁止
禁止用新订单替代原订单补单，会造成重复计费。`,
  },
  {
    title: "客服会话质检评分标准",
    summary: "会话质检的四个维度、权重与不合格判定条件。",
    assetType: "source_document",
    space: OPS,
    labels: ["qa", "quality", "support"],
    state: "published",
    body: `## 维度与权重
- 事实准确性 40%
- 合规表述 30%
- 响应时效 20%
- 情绪处理 10%

## 不合格判定
出现下列任一情况直接判不合格：承诺无法兑现的赔付、泄露他人信息、绕过审核流程。

## 抽样
每人每周抽取 10 通会话，高风险场景 100% 复核。`,
  },
  {
    title: "大促期间工单分流的临时规则",
    summary: "大促期间按客户等级与问题类型分流的临时优先级。",
    assetType: "procedure",
    space: OPS,
    labels: ["peak-season", "routing", "ops"],
    state: "published",
    body: `## 生效时间
大促开始前 24 小时至今后 72 小时，由值班负责人开启。

## 优先级
1. 支付成功但未发货
2. 企业客户任何工单
3. 退款与发票
4. 其他咨询

## 回滚
大促结束后由值班负责人关闭，未结工单回到常规队列并保留原优先级记录。`,
  },
  {
    title: "账号合并与数据迁移的边界条件",
    summary: "两个账号合并时哪些数据可迁移、哪些必须保留在原账号。",
    assetType: "source_document",
    space: SUPPORT,
    labels: ["account", "migration", "privacy"],
    state: "published",
    body: `## 可迁移
订单记录、优惠券、会员等级与积分。

## 不可迁移
实名认证信息、发票抬头历史、风控标记。

## 前置校验
两个账号均无未结退款、无进行中的争议、无司法冻结。

## 注意
合并后原账号不可恢复，必须在操作前取得客户书面确认。`,
  },
  {
    title: "优惠券叠加使用的判定顺序",
    summary: "多张优惠券同时可用时的叠加规则与计算顺序。",
    assetType: "source_document",
    space: BILLING,
    labels: ["coupon", "pricing", "billing"],
    state: "published",
    body: `## 判定顺序
1. 先校验互斥关系（同类券只取一张）
2. 再应用平台券
3. 最后应用店铺券

## 计算
按“先折扣后立减”的顺序计算，折扣券以原价为基数。

## 边界
运费券不参与商品金额计算，也不与满减门槛合并。`,
  },
  {
    title: "工单升级到二线的判定标准",
    summary: "一线可以自行结案的范围，以及必须升级到二线的情形。",
    assetType: "procedure",
    space: SUPPORT,
    labels: ["escalation", "support-core"],
    state: "published",
    body: `## 一线可结案
标准退款、发票重开、地址修改、物流查询。

## 必须升级
- 涉及赔付金额
- 涉及账号安全或数据泄露
- 客户已明确表示将投诉或起诉
- 同一问题第三次回访仍未解决

## 升级动作
在工单中标记 escalate，并同步到值班群，附上已核实的全部事实。`,
  },
  {
    title: "退款到账时效的对外口径",
    summary: "不同支付方式的退款到账时间，以及延迟时的解释方式。",
    assetType: "source_document",
    space: BILLING,
    labels: ["refund", "sla", "billing"],
    state: "published",
    body: `## 标准时效
- 余额：即时
- 微信/支付宝：1–3 个工作日
- 银行卡：3–7 个工作日
- 跨境信用卡：7–15 个工作日

## 延迟解释
只说明“已发起退款，剩余时间由发卡行处理”，不承诺具体到账日。

## 升级条件
超过标准时效 3 个工作日未到账，转二线核查。`,
  },
  {
    title: "黑产识别与账号风控处置流程",
    summary: "识别到疑似黑产账号后的处置顺序与不可逆操作的前置条件。",
    assetType: "procedure",
    space: OPS,
    labels: ["risk", "account", "ops"],
    state: "published",
    body: `## 识别信号
批量注册、设备指纹聚集、异常领取优惠券、支付失败率异常。

## 处置顺序
1. 限制优惠券领取
2. 要求二次验证
3. 冻结余额（需风控负责人审批）
4. 封禁账号（需留证并通知合规）

## 注意
任何冻结或封禁都必须保留证据链，且不得影响客户的正常退款请求。`,
  },
  {
    title: "服务中断的对外公告模板",
    summary: "服务中断期间公告的三个阶段与每阶段必须包含的信息。",
    assetType: "procedure",
    space: OPS,
    labels: ["incident", "communication", "ops"],
    state: "published",
    body: `## 三阶段
1. 已知晓：说明影响面与正在做的动作，不给时间承诺。
2. 处理中：每 30 分钟更新一次，包含已排除的原因。
3. 已恢复：给故障窗口、影响范围与后续动作。

## 禁止
禁止在没有定责前归因到客户侧，禁止使用“瞬时抖动”等弱化表述。`,
  },
  {
    title: "客户投诉升级的响应时限",
    summary: "不同等级投诉的首次响应与结案时限。",
    assetType: "source_document",
    space: SUPPORT,
    labels: ["complaint", "sla", "support-core"],
    state: "published",
    body: `## 时限
- 一般投诉：4 小时内首次响应，3 个工作日结案
- 重大投诉：1 小时内首次响应，24 小时内给出方案
- 监管转办：30 分钟内响应，全程留痕

## 记录要求
每次接触都写入工单，包含时间、渠道、对接人。`,
  },
  {
    title: "订阅续费失败的挽留话术",
    summary: "续费失败时的联系顺序，以及不可使用的施压话术。",
    assetType: "procedure",
    space: SUPPORT,
    labels: ["subscription", "retention", "support-core"],
    state: "published",
    body: `## 联系顺序
失败当天站内信 → 第 2 天短信 → 第 5 天人工外呼。

## 可以说
说明失败原因、给出可自助完成的路径、提示服务到期时间。

## 不可以说
不得暗示会立即删除数据，不得虚构涨价，不得绕过退订意愿。`,
  },
  {
    title: "账单争议的证据收集清单",
    summary: "客户对账单位置提出争议时需要收集的最小证据集。",
    assetType: "source_document",
    space: BILLING,
    labels: ["billing", "dispute", "evidence"],
    state: "published",
    body: `## 最小证据集
1. 计费明细与计量口径说明
2. 对应时段的服务日志
3. 客户侧的调用记录（如有）
4. 双方确认过的价格版本

## 时效
争议提出后 5 个工作日内完成取证，超时需要说明原因。`,
  },
  {
    title: "数据导出请求的合规处理",
    summary: "客户行使数据导出权时的处理边界与时限。",
    assetType: "procedure",
    space: OPS,
    labels: ["privacy", "export", "compliance"],
    state: "published",
    body: `## 处理时限
收到请求后 10 个工作日内提供，复杂请求可延长一次并告知理由。

## 提供范围
仅限请求人本人的数据；涉及第三方信息必须脱敏。

## 交付方式
通过一次性下载链接，有效期 72 小时，禁止通过聊天工具直接发送。`,
  },
  {
    title: "新客首单立减的活动规则",
    summary: "首单立减的适用条件、排除品类与风控要求。",
    assetType: "source_document",
    space: BILLING,
    labels: ["promotion", "coupon", "billing"],
    state: "candidate",
    body: `## 条件
新注册 7 天内、首笔订单、实付满 99 元。

## 排除
虚拟商品、跨境订单、企业采购订单。

## 待确认
与会员券叠加时的优先级尚未确定，暂不对外发布。`,
  },
  {
    title: "客服机器人转人工的触发条件",
    summary: "机器人在什么条件下必须让位给人工客服。",
    assetType: "procedure",
    space: SUPPORT,
    labels: ["bot", "handoff", "support-core"],
    state: "candidate",
    body: `## 触发条件
1. 连续两轮未识别意图
2. 客户明确要求人工
3. 涉及退款金额或账号安全
4. 客户情绪评分低于阈值

## 待补充
情绪评分的具体阈值需要在灰度中确定。`,
  },
  {
    title: "发票抬头修改的自助入口",
    summary: "客户自助修改发票抬头的入口与不可修改的情形。",
    assetType: "procedure",
    space: BILLING,
    labels: ["invoice", "self-service", "billing"],
    state: "needs_evidence",
    body: `## 入口
订单详情 → 发票 → 修改抬头（仅未开票状态可用）。

## 不可修改
已开票的必须走作废或红冲。`,
  },
  {
    title: "会员积分过期的提醒策略",
    summary: "积分到期前的提醒节奏与不可关闭的例外。",
    assetType: "source_document",
    space: SUPPORT,
    labels: ["membership", "points", "notification"],
    state: "needs_evidence",
    body: `## 提醒节奏
到期前 30 天、7 天、1 天各一次。

## 例外
高等级会员到期提醒不可关闭。`,
  },
  {
    title: "旧版工单系统的迁移说明",
    summary: "旧工单系统下线时的历史数据迁移方式。",
    assetType: "source_document",
    space: OPS,
    labels: ["migration", "legacy", "ops"],
    state: "rejected",
    body: `## 背景
旧系统将在本季度下线，历史工单需要迁移。

## 问题
迁移方案缺少对附件与内嵌图片的处理说明。`,
  },
  {
    title: "工单超时的自动升级规则",
    summary: "工单超过响应时限后的自动升级路径与通知对象。",
    assetType: "procedure",
    space: OPS,
    labels: ["escalation", "sla", "ops"],
    state: "verified",
    body: `## 触发
工单在首次响应时限内没有人工回复，自动升级一级。

## 通知
升级时同时通知当班组长与工单负责人，不通知客户。

## 次数上限
同一工单最多自动升级两次，之后必须人工介入。`,
  },
  {
    title: "客户身份核验的话术与禁区",
    summary: "电话与在线渠道核验客户身份时的标准问法与禁止索取的信息。",
    assetType: "source_document",
    space: SUPPORT,
    labels: ["identity", "privacy", "support-core"],
    state: "verified",
    body: `## 可核验项
订单号后四位、下单手机号后四位、收货城市。

## 禁止索取
完整身份证号、银行卡密码、短信验证码。

## 异常处理
客户无法提供任何核验项时，转二线并记录原因，不得直接拒绝服务。`,
  },
  {
    title: "退款审核的金额分级授权",
    summary: "不同金额区间的退款由谁审批，以及超限时的处理方式。",
    assetType: "procedure",
    space: BILLING,
    labels: ["refund", "approval", "billing"],
    state: "verified",
    body: `## 分级
- 0–200 元：一线可直接退
- 200–2000 元：组长审批
- 2000 元以上：财务复核

## 超限
超过 50000 元的退款必须走线下审批并留档，系统不提供一键操作。`,
  },
];

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/gu, "-").toLowerCase();
}

function sourceFor(seed: Seed): string {
  return `https://knowledge.local/sources/${slug(seed.title)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findContribution(role: "curator" | "publisher", id: string) {
  const list = await getContributions(role);
  return list.find((item) => item.receipt.contributionId === id);
}

async function publish(contributionId: string): Promise<string> {
  const curator = await findContribution("curator", contributionId);
  if (curator === undefined) throw new Error("找不到候选");
  if (curator.receipt.status === "candidate") {
    await reviewContribution({
      attestationRefs: [],
      contributionId,
      decision: "verify",
      etag: curator.etag,
      rationale: "结构、来源与适用范围完整，可用于演示。",
    });
  }
  const publisher = await findContribution("publisher", contributionId);
  if (publisher === undefined) throw new Error("候选未进入发布队列");
  const rawAttestations = publisher.reviewDecision?.attestationRefs;
  const attestations = Array.isArray(rawAttestations)
    ? rawAttestations.filter((value): value is string => typeof value === "string")
    : [];
  if (attestations.length === 0) throw new Error("服务端未生成审核证明");
  await applyGovernanceAction({
    action: "publish",
    attestationRefs: attestations,
    contributionId,
    etag: publisher.etag,
    policyEpoch: publisher.receipt.policyEpoch,
    rationale: "批准进入已发布账本，供检索与引用。",
  });
  return publisher.receipt.subjectRevisionId ?? "";
}

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg === undefined ? 0 : Number(limitArg.split("=")[1]);
const targets = limit > 0 ? SEEDS.slice(0, limit) : SEEDS;

const existingList = await getContributions("curator");
const existing = new Set(
  existingList
    .map((item) => item.request.manifest?.title)
    .filter((title): title is string => typeof title === "string"),
);
process.stdout.write(`已有知识 ${existing.size} 条，本次计划写入 ${targets.length} 条\n`);

const published: { revisionId: string; title: string }[] = [];
let created = 0;
let skipped = 0;

for (const seed of targets) {
  if (existing.has(seed.title)) {
    skipped += 1;
    continue;
  }
  const built = await buildKnowledgeContribution({
    assetType: seed.assetType,
    content: seed.body,
    evidenceRefs: [`https://knowledge.local/evidence/${slug(seed.title)}`],
    labels: seed.labels,
    primarySources: [sourceFor(seed)],
    rationale: `为客服与运营团队整理的可引用知识：${seed.summary}`,
    spaceId: seed.space,
    summary: seed.summary,
    title: seed.title,
  });
  const receipt = await createContribution(built);
  const contributionId = receipt.data.contributionId;

  if (seed.state === "published") {
    const revisionId = await publish(contributionId);
    published.push({
      revisionId: revisionId === "" ? built.revisionId : revisionId,
      title: seed.title,
    });
  } else if (seed.state === "verified") {
    const curator = await findContribution("curator", contributionId);
    if (curator !== undefined) {
      await reviewContribution({
        attestationRefs: [],
        contributionId,
        decision: "verify",
        etag: curator.etag,
        rationale: "证据与边界完整，等待 Publisher 绑定当前策略水位后发布。",
      });
    }
  } else if (seed.state === "needs_evidence") {
    const curator = await findContribution("curator", contributionId);
    if (curator !== undefined) {
      await reviewContribution({
        attestationRefs: [],
        contributionId,
        decision: "request_evidence",
        etag: curator.etag,
        rationale: "缺少原始来源链接，需要补充可核验的证据。",
      });
    }
  } else if (seed.state === "rejected") {
    const curator = await findContribution("curator", contributionId);
    if (curator !== undefined) {
      await reviewContribution({
        attestationRefs: [],
        contributionId,
        decision: "reject",
        etag: curator.etag,
        rationale: "方案缺少附件与内嵌图片的迁移处理，驳回重写。",
      });
    }
  }

  created += 1;
  process.stdout.write(`  + [${seed.state}] ${seed.title}\n`);
  await sleep(40);
}

process.stdout.write(`\n写入完成：新建 ${created}，跳过 ${skipped}\n`);

// 为一部分已发布知识记录真实的引用、使用与反馈
const feedbackTargets = published.slice(0, 12);
let usageRecorded = 0;
const outcomes = ["helped", "helped", "neutral", "helped", "harmed", "neutral"] as const;

for (const [index, target] of feedbackTargets.entries()) {
  const query = await searchKnowledge({ query: target.title, limit: 5 });
  const hit =
    query.results.find((result) => result.revisionId === target.revisionId) ?? query.results[0];
  if (hit === undefined) {
    process.stdout.write(`  ! 检索不到：${target.title}\n`);
    continue;
  }
  try {
    await recordKnowledgeOutcome({
      item: hit,
      outcome: outcomes[index % outcomes.length]!,
      queryReceiptId: query.queryReceiptId,
      taskCategory: index % 3 === 0 ? "customer-support/refund" : "customer-support/general",
    });
    usageRecorded += 1;
  } catch (error) {
    process.stdout.write(`  ! 反馈失败：${(error as Error).message}\n`);
  }
  await sleep(40);
}

process.stdout.write(`记录使用与反馈 ${usageRecorded} 条\n`);
process.stdout.write(
  `${JSON.stringify({ created, skipped, usage: usageRecorded, published: published.length })}\n`,
);
