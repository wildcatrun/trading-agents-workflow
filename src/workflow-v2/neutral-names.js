export const WORKFLOW_V2_GOVERNANCE_SYNTHESIS_NODE = "governance_synthesis";
export const WORKFLOW_V2_PROTOCOL_AUDIT_NODE = "protocol_audit";

export const WORKFLOW_V2_GOVERNANCE_REVIEW_STATE = "waiting_governance_review";
export const WORKFLOW_V2_LEGACY_GOVERNANCE_REVIEW_STATE = "waiting_cat_brain_check";

export const WORKFLOW_V2_PROTOCOL_AUDIT_STATE = "waiting_protocol_audit";
export const WORKFLOW_V2_LEGACY_PROTOCOL_AUDIT_STATE = "waiting_protocol_audit";

export const WORKFLOW_V2_PROTOCOL_AUDITED_PACKAGE_STATUS = "protocol_audited";
export const WORKFLOW_V2_LEGACY_PROTOCOL_AUDITED_PACKAGE_STATUS = "protocol_audited";

export const WORKFLOW_V2_SECRETARY_CLOSEOUT_REQUIRED = "secretary_closeout_required";
export const WORKFLOW_V2_LEGACY_SECRETARY_CLOSEOUT_REQUIRED = "cat_claw_summary_required";

export const WORKFLOW_V2_SECRETARY_DISPATCH_QUEUED = "secretary_dispatch_queued";
export const WORKFLOW_V2_LEGACY_SECRETARY_DISPATCH_QUEUED = "cat_claw_dispatch_queued";

export function workflowV2IsGovernanceReviewState(value = "") {
  return value === WORKFLOW_V2_GOVERNANCE_REVIEW_STATE || value === WORKFLOW_V2_LEGACY_GOVERNANCE_REVIEW_STATE;
}

export function workflowV2IsProtocolAuditState(value = "") {
  return value === WORKFLOW_V2_PROTOCOL_AUDIT_STATE || value === WORKFLOW_V2_LEGACY_PROTOCOL_AUDIT_STATE;
}

export function workflowV2IsProtocolAuditedPackageStatus(value = "") {
  return value === WORKFLOW_V2_PROTOCOL_AUDITED_PACKAGE_STATUS || value === WORKFLOW_V2_LEGACY_PROTOCOL_AUDITED_PACKAGE_STATUS;
}

export function workflowV2IsSecretaryCloseoutRequired(value = "") {
  return value === WORKFLOW_V2_SECRETARY_CLOSEOUT_REQUIRED || value === WORKFLOW_V2_LEGACY_SECRETARY_CLOSEOUT_REQUIRED;
}

export function workflowV2IsSecretaryDispatchQueued(value = "") {
  return value === WORKFLOW_V2_SECRETARY_DISPATCH_QUEUED || value === WORKFLOW_V2_LEGACY_SECRETARY_DISPATCH_QUEUED;
}
