const { createHmac } = require("crypto");

function readBooleanEnv(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return null;
  return value === "1" || value === "true" || value === "yes";
}

function shouldRequireTenantIngressScope() {
  const configured = readBooleanEnv("TENANT_INGRESS_REQUIRE_SCOPE");
  if (configured !== null) return configured;
  return process.env.NODE_ENV === "production";
}

function shouldRequireTenantIngressSignature() {
  const configured = readBooleanEnv("TENANT_INGRESS_REQUIRE_SIGNATURE");
  if (configured !== null) return configured;
  return process.env.NODE_ENV === "production";
}

function requestPathForSignature(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function signingSecretMap() {
  const raw = process.env.TENANT_INGRESS_SIGNING_SECRETS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
        .filter(([key, value]) => key && value)
    );
  } catch {
    return {};
  }
}

function tenantIngressSigningSecret(tenantKey, workspaceKey) {
  const secrets = signingSecretMap();
  const secret =
    secrets[`${tenantKey}:${workspaceKey}`] ??
    secrets[`${tenantKey}:*`] ??
    secrets[tenantKey] ??
    secrets["*"] ??
    null;
  if (secret) return secret;

  const globalSecret = process.env.TENANT_INGRESS_SIGNING_SECRET?.trim();
  const allowGlobal = readBooleanEnv("TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET") === true;
  if (globalSecret && (allowGlobal || process.env.NODE_ENV !== "production")) {
    return globalSecret;
  }
  return null;
}

function buildTenantIngressSignature({ tenantKey, workspaceKey, method, path, timestamp, secret }) {
  const payload = [
    "tenant-ingress.v1",
    tenantKey,
    workspaceKey,
    method.trim().toUpperCase() || "GET",
    path || "/",
    timestamp
  ].join("\n");
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

function tenantIngressHeaders({ url, method = "GET", headers = {} }) {
  const tenantKey = process.env.TENANT_INGRESS_TENANT?.trim() ?? "";
  const workspaceKey = process.env.TENANT_INGRESS_WORKSPACE?.trim() ?? "";
  const requireScope = shouldRequireTenantIngressScope() || shouldRequireTenantIngressSignature();
  const requireSignature = shouldRequireTenantIngressSignature();

  if ((tenantKey && !workspaceKey) || (!tenantKey && workspaceKey)) {
    throw new Error("Both TENANT_INGRESS_TENANT and TENANT_INGRESS_WORKSPACE are required.");
  }

  if (!tenantKey && !workspaceKey) {
    if (requireScope) {
      throw new Error(
        "TENANT_INGRESS_TENANT and TENANT_INGRESS_WORKSPACE are required for machine ingress."
      );
    }
    return { ...headers };
  }

  const nextHeaders = {
    ...headers,
    "x-6esk-tenant": tenantKey,
    "x-6esk-workspace": workspaceKey
  };

  if (requireSignature || tenantIngressSigningSecret(tenantKey, workspaceKey)) {
    const secret = tenantIngressSigningSecret(tenantKey, workspaceKey);
    if (!secret) {
      throw new Error("TENANT_INGRESS_SIGNING_SECRETS_JSON is missing a secret for this tenant.");
    }
    const timestamp = new Date().toISOString();
    nextHeaders["x-6esk-tenant-timestamp"] = timestamp;
    nextHeaders["x-6esk-tenant-signature"] = buildTenantIngressSignature({
      tenantKey,
      workspaceKey,
      method,
      path: requestPathForSignature(url),
      timestamp,
      secret
    });
  }

  return nextHeaders;
}

module.exports = {
  buildTenantIngressSignature,
  tenantIngressHeaders
};
