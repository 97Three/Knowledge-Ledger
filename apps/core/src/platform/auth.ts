import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppConfig, AuthMode } from "../config.js";
import { ProblemError } from "./problem.js";

declare module "fastify" {
  interface FastifyRequest {
    nianAuthFailed?: boolean;
    nianAuthMode?: AuthMode;
    nianPrincipal?: Principal;
    nianTenantId?: string;
  }
}

export interface Principal {
  readonly scopes: ReadonlySet<string>;
  readonly subject: string;
  readonly subjectDigest: string;
  readonly supportedObligations: readonly unknown[];
  readonly tenantId: string;
}

type UnboundPrincipal = Omit<Principal, "tenantId">;

const DEVELOPMENT_TOKENS = new Map<string, UnboundPrincipal>([
  [
    "dev-reader",
    createUnboundPrincipal(
      "urn:nian:development:reader",
      [
        "nian:classification:internal",
        "nian:feedback",
        "nian:policy:*",
        "nian:query",
        "nian:read",
        "nian:space:*",
      ],
      ["cite", "no-train"],
    ),
  ],
  [
    "dev-observer",
    createUnboundPrincipal("urn:nian:development:observer", ["nian:observe"]),
  ],
  [
    "dev-contributor",
    createUnboundPrincipal(
      "urn:nian:development:contributor",
      [
        "nian:classification:internal",
        "nian:contribute",
        "nian:feedback",
        "nian:policy:*",
        "nian:query",
        "nian:read",
        "nian:space:*",
      ],
      ["cite", "no-train"],
    ),
  ],
  [
    "dev-console",
    createUnboundPrincipal("urn:nian:development:console", [
      "nian:classification:*",
      "nian:console",
      "nian:policy:*",
      "nian:space:*",
    ]),
  ],
  [
    "dev-curator",
    createUnboundPrincipal("urn:nian:development:curator", [
      "nian:classification:internal",
      "nian:policy:*",
      "nian:read",
      "nian:review",
      "nian:space:*",
    ]),
  ],
  [
    "dev-evaluator",
    createUnboundPrincipal("urn:nian:development:evaluator", [
      "nian:classification:internal",
      "nian:evaluate",
      "nian:policy:*",
      "nian:read",
      "nian:space:*",
    ]),
  ],
  [
    "dev-publisher",
    createUnboundPrincipal("urn:nian:development:publisher", [
      "nian:classification:internal",
      "nian:policy:*",
      "nian:publish",
      "nian:read",
      "nian:space:*",
    ]),
  ],
  [
    "dev-incident",
    createUnboundPrincipal("urn:nian:development:incident", [
      "nian:classification:internal",
      "nian:incident",
      "nian:policy:*",
      "nian:read",
      "nian:space:*",
    ]),
  ],
  [
    "dev-eraser",
    createUnboundPrincipal("urn:nian:development:eraser", [
      "nian:classification:internal",
      "nian:erase",
      "nian:policy:*",
      "nian:read",
      "nian:space:*",
    ]),
  ],
]);

function createUnboundPrincipal(
  subject: string,
  scopes: readonly string[],
  supportedObligations: readonly unknown[] = [],
): UnboundPrincipal {
  return {
    scopes: new Set(scopes),
    subject,
    subjectDigest: `sha256:${createHash("sha256").update(subject).digest("hex")}`,
    supportedObligations: Object.freeze([...supportedObligations]),
  };
}

function bindTenant(principal: UnboundPrincipal, tenantId: string): Principal {
  return { ...principal, tenantId };
}

export function installAuthentication(app: FastifyInstance, config: AppConfig): void {
  app.decorateRequest("nianAuthFailed", undefined);
  app.decorateRequest("nianAuthMode", undefined);
  app.decorateRequest("nianPrincipal", undefined);
  app.decorateRequest("nianTenantId", undefined);
  if (config.authMode === "development") {
    app.addHook("onRequest", async (request) => {
      request.nianAuthMode = "development";
      request.nianTenantId = config.tenantId;
    });
    return;
  }

  const oidc = config.oidc;
  if (oidc === undefined) throw new Error("OIDC configuration is missing");
  const keySet = createRemoteJWKSet(new URL(oidc.jwksUri), {
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
  app.addHook("onRequest", async (request) => {
    request.nianAuthMode = "oidc";
    request.nianTenantId = config.tenantId;
    const authorization = request.headers.authorization;
    if (authorization === undefined || !authorization.startsWith("Bearer ")) return;
    try {
      const verified = await jwtVerify(authorization.slice("Bearer ".length), keySet, {
        algorithms: ["RS256", "ES256", "EdDSA"],
        audience: oidc.audience,
        clockTolerance: 5,
        issuer: oidc.issuer,
        requiredClaims: ["sub", "iat", "exp"],
      });
      const tokenType = verified.protectedHeader.typ;
      if (
        typeof tokenType !== "string" ||
        !oidc.accessTokenTypes.includes(tokenType)
      ) {
        throw new Error("JWT typ is not an allowed access-token type");
      }
      const subject = verified.payload.sub;
      if (subject === undefined || subject.length === 0) throw new Error("JWT subject is missing");
      const issuedAt = verified.payload.iat;
      const expiresAt = verified.payload.exp;
      if (
        typeof issuedAt !== "number" ||
        typeof expiresAt !== "number" ||
        !Number.isSafeInteger(issuedAt) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= issuedAt ||
        expiresAt - issuedAt > oidc.maxTokenLifetimeSeconds
      ) {
        throw new Error("JWT lifetime is invalid");
      }
      const scopeClaim = verified.payload.scope;
      const scpClaim = verified.payload.scp;
      const scopes = new Set<string>();
      if (typeof scopeClaim === "string") {
        for (const scope of scopeClaim.split(/\s+/u)) if (scope.length > 0) scopes.add(scope);
      }
      if (typeof scpClaim === "string") {
        for (const scope of scpClaim.split(/\s+/u)) if (scope.length > 0) scopes.add(scope);
      } else if (Array.isArray(scpClaim)) {
        for (const scope of scpClaim) if (typeof scope === "string") scopes.add(scope);
      }
      const identity = `${oidc.issuer}\0${subject}`;
      const identityDigest = createHash("sha256").update(identity).digest("hex");
      const supportedObligations = parseTrustedObligations(
        verified.payload.nian_obligations,
      );
      const tenantId = parseTrustedTenant(
        verified.payload[oidc.tenantClaim],
        config.tenantId,
      );
      request.nianPrincipal = bindTenant(
        createUnboundPrincipal(
          `urn:nian:principal:sha256:${identityDigest}`,
          [...scopes],
          supportedObligations,
        ),
        tenantId,
      );
    } catch {
      request.nianAuthFailed = true;
    }
  });
}

function parseTrustedTenant(value: unknown, deploymentTenantId: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error("The signed tenant claim is missing or invalid");
  }
  let tenantId: string;
  try {
    tenantId = new URL(value).toString().replace(/\/$/u, "");
  } catch {
    throw new Error("The signed tenant claim is not an absolute URI");
  }
  if (tenantId !== deploymentTenantId) {
    throw new Error("The signed tenant claim does not match this deployment");
  }
  return tenantId;
}

function parseTrustedObligations(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("nian_obligations must be an array");
  }
  for (const obligation of value) {
    if (obligation === "cite" || obligation === "no-train") continue;
    if (
      typeof obligation !== "object" ||
      obligation === null ||
      Array.isArray(obligation)
    ) {
      throw new Error("nian_obligations contains an unsupported value");
    }
    const entries = Object.entries(obligation);
    const digest = (obligation as Record<string, unknown>).digest;
    const uri = (obligation as Record<string, unknown>).uri;
    if (
      entries.length !== 2 ||
      !entries.every(([key]) => key === "digest" || key === "uri") ||
      typeof digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
      typeof uri !== "string" ||
      uri.length > 2_048 ||
      !isAbsoluteUri(uri)
    ) {
      throw new Error("nian_obligations contains an invalid schema reference");
    }
  }
  return value;
}

function isAbsoluteUri(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authenticate(
  request: FastifyRequest,
  requiredScope: string,
): Principal {
  if (request.nianAuthMode === "oidc") {
    return requireOidcPrincipal(request, [requiredScope]);
  }
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "A bearer credential is required.",
    );
  }
  const provided = authorization.slice("Bearer ".length);
  let principal: Principal | undefined;
  for (const [token, candidate] of DEVELOPMENT_TOKENS) {
    if (constantTimeTokenMatch(provided, token)) {
      principal = bindTenant(candidate, requireDeploymentTenant(request));
      break;
    }
  }
  if (principal === undefined) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "The bearer credential is invalid.",
    );
  }
  if (!principal.scopes.has(requiredScope)) {
    throw new ProblemError(
      403,
      "NIAN_POLICY_DENIED",
      "The caller does not have the required scope.",
    );
  }
  return principal;
}

export function authenticateAny(
  request: FastifyRequest,
  requiredScopes: readonly string[],
): Principal {
  if (request.nianAuthMode === "oidc") {
    return requireOidcPrincipal(request, requiredScopes);
  }
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "A bearer credential is required.",
    );
  }
  const provided = authorization.slice("Bearer ".length);
  let principal: Principal | undefined;
  for (const [token, candidate] of DEVELOPMENT_TOKENS) {
    if (constantTimeTokenMatch(provided, token)) {
      principal = bindTenant(candidate, requireDeploymentTenant(request));
      break;
    }
  }
  if (principal === undefined) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "The bearer credential is invalid.",
    );
  }
  if (!requiredScopes.some((scope) => principal.scopes.has(scope))) {
    throw new ProblemError(
      403,
      "NIAN_POLICY_DENIED",
      "The caller does not have any accepted scope for this operation.",
    );
  }
  return principal;
}

function requireOidcPrincipal(
  request: FastifyRequest,
  requiredScopes: readonly string[],
): Principal {
  const principal = request.nianPrincipal;
  if (
    request.nianAuthFailed === true ||
    principal === undefined ||
    principal.tenantId !== request.nianTenantId
  ) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "A valid audience-bound bearer credential is required.",
    );
  }
  if (!requiredScopes.some((scope) => principal.scopes.has(scope))) {
    throw new ProblemError(
      403,
      "NIAN_POLICY_DENIED",
      "The caller does not have any accepted scope for this operation.",
    );
  }
  return principal;
}

function requireDeploymentTenant(request: FastifyRequest): string {
  if (request.nianTenantId === undefined) {
    throw new ProblemError(
      401,
      "NIAN_AUTHENTICATION_REQUIRED",
      "The request is not bound to a trusted Tenant.",
    );
  }
  return request.nianTenantId;
}
