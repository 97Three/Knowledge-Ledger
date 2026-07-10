export interface NIANClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly supportedObligations?: readonly unknown[];
  readonly token: string | (() => Promise<string> | string);
}

export interface Citation {
  readonly citationId: string;
  readonly locator: Record<string, unknown>;
  readonly payloadDigest: string;
  readonly quote?: string;
  readonly revisionId?: string;
}

export interface QueryResult {
  readonly assetType: string;
  readonly citations: readonly Citation[];
  readonly obligations: readonly unknown[];
  readonly qualityDecision: string;
  readonly qualityReasons: readonly string[];
  readonly recordId: string;
  readonly revisionId: string;
  readonly scores: readonly { readonly method: string; readonly value: number }[];
  readonly spaceId: string;
  readonly summary?: string;
  readonly title: string;
}

export interface QueryResponse {
  readonly nextCursor?: string;
  readonly policyEpoch: string;
  readonly queryReceiptId: string;
  readonly results: readonly QueryResult[];
  readonly snapshot: string;
}

export interface ContextPack {
  readonly budget: Readonly<Record<string, number>>;
  readonly contextDigest: string;
  readonly contextPackId: string;
  readonly createdAt: string;
  readonly exposureReceiptId: string;
  readonly obligations: readonly unknown[];
  readonly passages: readonly Record<string, unknown>[];
  readonly policyEpoch: string;
  readonly warnings: readonly Record<string, unknown>[];
}

export interface RevisionRead {
  readonly exposureReceipt: Record<string, unknown>;
  readonly exposureReceiptId: string;
  readonly qualityAttestation?: string;
  readonly qualityDecision?: string;
  readonly revision: Record<string, unknown>;
}

export class NIANError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = "NIANError";
  }
}

export class NIANClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #obligations: readonly unknown[];
  readonly #token: NIANClientOptions["token"];

  public constructor(options: NIANClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#obligations = options.supportedObligations ?? ["cite", "no-train"];
    this.#token = options.token;
  }

  public async discover(): Promise<Record<string, unknown>> {
    return this.#request<Record<string, unknown>>(
      new URL("/.well-known/nian", this.#baseUrl).toString(),
      { authenticated: false },
    );
  }

  public async query(input: {
    readonly cursor?: string;
    readonly filters?: Record<string, unknown>;
    readonly include?: readonly string[];
    readonly limit?: number;
    readonly mode?: "exact" | "hybrid" | "lexical" | "semantic";
    readonly purpose: string;
    readonly spaces?: readonly string[];
    readonly text: string;
  }): Promise<QueryResponse> {
    return this.#request<QueryResponse>(`${this.#baseUrl}/queries`, {
      body: {
        nianVersion: "0.1",
        critical: [],
        extensions: {},
        include: input.include ?? ["summary", "passages", "provenance", "attestations"],
        limit: input.limit ?? 10,
        mode: input.mode ?? "lexical",
        purpose: input.purpose,
        query: { text: input.text },
        supportedObligations: this.#obligations,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
        ...(input.spaces === undefined ? {} : { spaces: input.spaces }),
      },
      method: "POST",
    });
  }

  public async createContextPack(input: {
    readonly budgetCharacters?: number;
    readonly purpose: string;
    readonly spaces?: readonly string[];
    readonly task: string;
  }): Promise<ContextPack> {
    return this.#request<ContextPack>(`${this.#baseUrl}/context-packs`, {
      body: {
        nianVersion: "0.1",
        budget: { maxCharacters: input.budgetCharacters ?? 12_000 },
        critical: [],
        extensions: {},
        mode: "lexical",
        purpose: input.purpose,
        supportedObligations: this.#obligations,
        task: input.task,
        ...(input.spaces === undefined ? {} : { spaces: input.spaces }),
      },
      method: "POST",
    });
  }

  public async getRevision(input: {
    readonly purpose: string;
    readonly revisionId: string;
    readonly spaceId: string;
  }): Promise<RevisionRead> {
    const result = await this.#requestResponse<Record<string, unknown>>(
      `${this.#baseUrl}/spaces/${encodeURIComponent(input.spaceId)}/revisions/${encodeURIComponent(input.revisionId)}`,
      {
        headers: {
          "NIAN-Obligation-Support": base64Url(canonicalJson(this.#obligations)),
          "NIAN-Purpose": input.purpose,
        },
      },
    );
    const exposureReceiptId = result.response.headers.get("NIAN-Read-Receipt");
    if (exposureReceiptId === null) {
      throw new NIANError(
        502,
        "NIAN_RECEIPT_MISSING",
        "The NIAN node returned a Revision without a read Exposure Receipt.",
      );
    }
    const qualityAttestation = result.response.headers.get("NIAN-Quality-Attestation");
    const qualityDecision = result.response.headers.get("NIAN-Quality-Decision");
    const exposureReceipt = await this.#request<Record<string, unknown>>(
      `${this.#baseUrl}/exposure-receipts/${encodeURIComponent(exposureReceiptId)}`,
      {},
    );
    return {
      exposureReceipt,
      exposureReceiptId,
      ...(qualityAttestation === null ? {} : { qualityAttestation }),
      ...(qualityDecision === null ? {} : { qualityDecision }),
      revision: result.data,
    };
  }

  public async recordUsage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#request<Record<string, unknown>>(`${this.#baseUrl}/usages`, {
      body: { nianVersion: "0.1", critical: [], extensions: {}, ...input },
      idempotencyKey: `sdk-usage-${crypto.randomUUID()}`,
      method: "POST",
    });
  }

  public async recordFeedback(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#request<Record<string, unknown>>(`${this.#baseUrl}/feedback`, {
      body: { nianVersion: "0.1", critical: [], extensions: {}, ...input },
      idempotencyKey: `sdk-feedback-${crypto.randomUUID()}`,
      method: "POST",
    });
  }

  public async contribute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#request<Record<string, unknown>>(`${this.#baseUrl}/contributions`, {
      body: input,
      idempotencyKey: `sdk-contribution-${crypto.randomUUID()}`,
      method: "POST",
    });
  }

  async #request<T>(
    url: string,
    options: {
      readonly authenticated?: boolean;
      readonly body?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
      readonly idempotencyKey?: string;
      readonly method?: string;
    },
  ): Promise<T> {
    return (await this.#requestResponse<T>(url, options)).data;
  }

  async #requestResponse<T>(
    url: string,
    options: {
      readonly authenticated?: boolean;
      readonly body?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
      readonly idempotencyKey?: string;
      readonly method?: string;
    },
  ): Promise<{ readonly data: T; readonly response: Response }> {
    const headers = new Headers(options.headers);
    headers.set("NIAN-Version", "0.1");
    headers.set("Accept", "application/json");
    if (options.authenticated !== false) {
      const token = typeof this.#token === "function" ? await this.#token() : this.#token;
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
    const response = await this.#fetch(url, {
      headers,
      method: options.method ?? "GET",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as {
        readonly code?: string;
        readonly detail?: string;
        readonly title?: string;
        readonly traceId?: string;
      };
      throw new NIANError(
        response.status,
        problem.code ?? "NIAN_HTTP_ERROR",
        problem.detail ?? problem.title ?? `NIAN request failed (${response.status})`,
        problem.traceId,
      );
    }
    return { data: await response.json() as T, response };
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Value is not JSON-serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`
  ).join(",")}}`;
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
