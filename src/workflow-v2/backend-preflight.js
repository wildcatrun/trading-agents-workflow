import {
  WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS,
  WORKFLOW_V2_WORKER_BACKENDS
} from "./constants.js";
import {
  workflowV2JsonObject,
  workflowV2NormalizeBackend,
  workflowV2ValidationError
} from "./helpers.js";

function requireDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 backend-preflight dependency missing: ${name}`);
  return value;
}

export async function workflowV2WorkerBackendPreflight(rootDir, input = {}, deps = {}) {
  const workflowPaths = requireDep(deps, "workflowPaths");
  const firstText = requireDep(deps, "firstText");
  const boolOption = requireDep(deps, "boolOption");
  const safeId = requireDep(deps, "safeId");
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const warnings = [];
  const backendId = workflowV2NormalizeBackend(input.backendId || input.backend_id || input.runtimeBackend || input.runtime_backend || "hermers_docker_worker");
  if (WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS.has(backendId)) {
    errors.push(workflowV2ValidationError("openclaw_worker_backend_disallowed", "OpenClaw is not allowed as a workflow v2 worker runtime backend"));
  } else if (!WORKFLOW_V2_WORKER_BACKENDS.has(backendId)) {
    warnings.push(workflowV2ValidationError("unknown_worker_backend", `unknown worker backend will require explicit adapter registration: ${backendId}`));
  }
  const modelRoute = workflowV2JsonObject(input.modelRoute ?? input.model_route, {});
  const expectedProviderModel = firstText(modelRoute.providerModel, modelRoute.provider_model, input.providerModel, input.provider_model, "openai-codex/gpt-5.5");
  if (!expectedProviderModel.startsWith("openai-codex/")) {
    warnings.push(workflowV2ValidationError("model_route_not_codex_quota_path", "expected provider model should use openai-codex/<model> for Codex quota accounting", { expectedProviderModel }));
  }
  const receiptInput = input.receipt ?? input.modelReceipt ?? input.model_receipt;
  const receiptProvided = receiptInput !== undefined && receiptInput !== null && receiptInput !== "";
  const receipt = workflowV2JsonObject(receiptInput, {});
  const receiptKeys = ["provider", "model", "fallbackAttempts", "errorCode"];
  const missingReceiptKeys = receiptKeys.filter((key) => !Object.prototype.hasOwnProperty.call(receipt, key));
  if (!receiptProvided) {
    errors.push(workflowV2ValidationError("model_receipt_required", "worker backend preflight requires observed model receipt evidence"));
  } else if (missingReceiptKeys.length) {
    errors.push(workflowV2ValidationError("model_receipt_missing_required_fields", "model receipt must include provider, model, fallbackAttempts, and errorCode", { missingReceiptKeys }));
  }
  if (receiptProvided && Object.keys(receipt).length > 0) {
    const observedProviderModel = `${receipt.provider || ""}/${receipt.model || ""}`.replace(/\/+$/g, "");
    if (receipt.provider && receipt.model && observedProviderModel !== expectedProviderModel) {
      errors.push(workflowV2ValidationError("model_route_mismatch", "observed model receipt does not match expected route", { expectedProviderModel, observedProviderModel }));
    }
    if (Number(receipt.fallbackAttempts || 0) > 0 && boolOption(input.fallbackAllowed ?? input.fallback_allowed, false) === false) {
      errors.push(workflowV2ValidationError("model_fallback_disallowed", "fallbackAttempts must be zero when fallbackAllowed=false", { fallbackAttempts: Number(receipt.fallbackAttempts || 0) }));
    }
  }
  const oauthInput = input.oauth ?? input.oauthStatus ?? input.oauth_status;
  const oauthProvided = oauthInput !== undefined && oauthInput !== null && oauthInput !== "";
  const oauth = workflowV2JsonObject(oauthInput, {});
  if (!oauthProvided || Object.keys(oauth).length === 0) {
    errors.push(workflowV2ValidationError("oauth_status_required", "worker backend preflight requires OAuth expiry and refresh evidence"));
  }
  const oauthHasExpiry = Object.prototype.hasOwnProperty.call(oauth, "expiryOk") || Object.prototype.hasOwnProperty.call(oauth, "expiry_ok") || Object.prototype.hasOwnProperty.call(oauth, "expired");
  const oauthHasRefresh = Object.prototype.hasOwnProperty.call(oauth, "refreshOk") || Object.prototype.hasOwnProperty.call(oauth, "refresh_ok");
  if (oauthProvided && Object.keys(oauth).length > 0 && (!oauthHasExpiry || !oauthHasRefresh)) {
    errors.push(workflowV2ValidationError("oauth_status_missing_required_fields", "OAuth status must include expiryOk/expiry_ok and refreshOk/refresh_ok evidence"));
  }
  if (oauth.expiryOk === false || oauth.expiry_ok === false || oauth.expired === true) {
    errors.push(workflowV2ValidationError("oauth_token_expired", "OpenAI/Codex OAuth token is expired or expiry check failed"));
  }
  if (oauth.refreshOk === false || oauth.refresh_ok === false) {
    errors.push(workflowV2ValidationError("oauth_refresh_failed", "OpenAI/Codex OAuth refresh check failed"));
  }
  if (oauth.revocationVerified === false || oauth.revocation_verified === false) {
    warnings.push(workflowV2ValidationError("oauth_revocation_unverified", "OAuth revocation/rotation evidence is not verified"));
  }
  const networkInput = input.network ?? input.networkPolicy ?? input.network_policy;
  const networkProvided = networkInput !== undefined && networkInput !== null && networkInput !== "";
  const network = workflowV2JsonObject(networkInput, {});
  if (!networkProvided || Object.keys(network).length === 0) {
    errors.push(workflowV2ValidationError("network_policy_required", "worker backend preflight requires host-only Tailscale and container exposure evidence"));
  }
  const networkHasHostOnly = Object.prototype.hasOwnProperty.call(network, "hostOnlyTailscale") || Object.prototype.hasOwnProperty.call(network, "host_only_tailscale");
  const networkHasWslTailscaled = Object.prototype.hasOwnProperty.call(network, "wslTailscaledActive") || Object.prototype.hasOwnProperty.call(network, "wsl_tailscaled_active");
  const networkHasDirectPort = Object.prototype.hasOwnProperty.call(network, "directContainerPortExposed") || Object.prototype.hasOwnProperty.call(network, "direct_container_port_exposed");
  if (networkProvided && Object.keys(network).length > 0 && (!networkHasHostOnly || !networkHasWslTailscaled || !networkHasDirectPort)) {
    errors.push(workflowV2ValidationError("network_policy_missing_required_fields", "network policy must include hostOnlyTailscale, wslTailscaledActive, and directContainerPortExposed evidence"));
  }
  if (network.wslTailscaledActive === true || network.wsl_tailscaled_active === true) {
    errors.push(workflowV2ValidationError("wsl_tailscaled_disallowed", "wsl-agents must use Windows host-only Tailscale; do not start WSL tailscaled"));
  }
  if (network.directContainerPortExposed === true || network.direct_container_port_exposed === true) {
    errors.push(workflowV2ValidationError("direct_container_port_disallowed", "worker containers should not expose unmanaged direct ports"));
  }
  if (network.hostOnlyTailscale === false || network.host_only_tailscale === false) {
    warnings.push(workflowV2ValidationError("host_only_tailscale_not_verified", "host-only Tailscale path is not verified"));
  }
  const preflight = {
    preflightId: firstText(input.preflightId, input.preflight_id) || safeId("v2-preflight"),
    workflowId: firstText(input.workflowId, input.workflow_id),
    backendId,
    hostAlias: firstText(input.hostAlias, input.host_alias, "wsl-agents"),
    allowed: errors.length === 0,
    status: errors.length ? "fail" : warnings.length ? "warn" : "pass",
    expectedProviderModel,
    requiredReceiptFields: receiptKeys,
    disallowedActions: [
      "start_openclaw_worker_runtime",
      "start_wsl_tailscaled",
      "expose_unmanaged_container_port",
      "treat_fallback_receipt_as_primary_success"
    ],
    checks: {
      backendAllowed: !WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS.has(backendId),
      modelRouteObserved: Object.keys(receipt).length > 0,
      oauthObserved: Object.keys(oauth).length > 0,
      hostOnlyTailscaleObserved: Object.keys(network).length > 0
    }
  };
  return {
    operation: "workflow.v2.worker_backend.preflight",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    warnings,
    preflight,
    dbFile: paths.dbFile,
    writes: []
  };
}
