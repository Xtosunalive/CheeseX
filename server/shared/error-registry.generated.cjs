// GENERATED FILE — DO NOT EDIT. 真身=抛点；变更后运行 `npm run gen:error-registry` 再生成。
// PR-158（副本→计算第一刀）：错误码唯一账本——出生即账，账本由生成器从抛点真身产出（确定性输出）。
// 消费方：server/shared/error-factory.cjs（strict 模式未知码即炸）；check:error-registry 门禁（freshness）。
module.exports = {
  "codes": {
    "ACTION_APPROVAL_ERROR": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/action-approval-routes.cjs:63"
      ]
    },
    "ACTION_APPROVAL_REQUIRED": {
      "statuses": [
        403
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:230"
      ]
    },
    "ACTION_AUDIT_APPEND_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:276"
      ]
    },
    "ACTION_CONFIRM_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:229"
      ]
    },
    "ACTION_EXECUTOR_UNREGISTERED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:239"
      ]
    },
    "ACTION_FACTORY_UNAVAILABLE": {
      "statuses": [
        503
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:180",
        "server/shared/action-execution-factory.cjs:190"
      ]
    },
    "ACTION_NOT_ACTIVE": {
      "statuses": [],
      "sites": [
        "server/shared/action-execution-factory.cjs:199"
      ]
    },
    "ACTION_POSTCHECK_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:263",
        "server/shared/action-execution-factory.cjs:269"
      ]
    },
    "ACTION_PRECONDITION_FAILED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:220"
      ]
    },
    "ACTION_PRECONDITION_UNKNOWN": {
      "statuses": [
        500
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:214"
      ]
    },
    "ACTION_RISK_BLOCKED": {
      "statuses": [
        403
      ],
      "sites": [
        "server/shared/action-execution-factory.cjs:231"
      ]
    },
    "ALIAS_AMBIGUOUS": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:239"
      ]
    },
    "ANOMALY_ACTION_INPUT_REQUIRED": {
      "statuses": [
        400,
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-action-adapter.cjs:16",
        "server/services/anomaly/anomaly-action-adapter.cjs:60",
        "server/services/anomaly/anomaly-action-adapter.cjs:94",
        "server/services/anomaly/anomaly-action-adapter.cjs:97"
      ]
    },
    "ANOMALY_EVIDENCE_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:386"
      ]
    },
    "ANOMALY_LEDGER_CORRUPT": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:195"
      ]
    },
    "ANOMALY_LEDGER_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:199"
      ]
    },
    "ANOMALY_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:331"
      ]
    },
    "ANOMALY_PREVIEW_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:421"
      ]
    },
    "ANOMALY_SOURCE_CHANGED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-action-adapter.cjs:23",
        "server/services/anomaly/anomaly-action-adapter.cjs:120"
      ]
    },
    "ANOMALY_STATE_TRANSITION_FORBIDDEN": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:32"
      ]
    },
    "APPROVAL_ALREADY_DECIDED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/governance/action-approval-store.cjs:92"
      ]
    },
    "APPROVAL_EVIDENCE_STALE": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:90",
        "server/services/release-governance/approval-state-machine-service.cjs:396",
        "server/services/release-governance/approval-state-machine-service.cjs:497",
        "server/services/release-governance/approval-state-machine-service.cjs:500"
      ]
    },
    "APPROVAL_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/governance/action-approval-store.cjs:90"
      ]
    },
    "ARTICLES_HEALTH_UNAVAILABLE": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/article-health-routes.cjs:27"
      ]
    },
    "ARTICLE_ASSOCIATIONS_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:68"
      ]
    },
    "ARTICLE_ASSOCIATION_AUDIT_CORRUPT": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:302",
        "server/services/article-workflow/article-association-service.cjs:374"
      ]
    },
    "ARTICLE_ASSOCIATION_COMMIT_INCONSISTENT": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:361"
      ]
    },
    "ARTICLE_ASSOCIATION_SAVE_NOT_CONFIGURED": {
      "statuses": [
        503
      ],
      "sites": [
        "server/routes/article-association-routes.cjs:22"
      ]
    },
    "ARTICLE_FORMAL_IDENTITY_AMBIGUOUS": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:718"
      ]
    },
    "ARTICLE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:281",
        "server/services/article-workflow/article-workflow-service.cjs:246",
        "server/services/article-workflow/article-workflow-service.cjs:286",
        "server/services/article-workflow/article-workflow-service.cjs:290",
        "server/services/article-workflow/article-workflow-service.cjs:413"
      ]
    },
    "ARTICLE_NOT_STANDARDIZED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:244",
        "server/services/release-governance/approval-state-machine-service.cjs:335",
        "server/services/release-governance/approval-state-machine-service.cjs:347",
        "server/services/release-governance/approval-state-machine-service.cjs:383",
        "server/services/release-governance/approval-state-machine-service.cjs:393",
        "server/services/release-governance/approval-state-machine-service.cjs:428"
      ]
    },
    "ARTICLE_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:91",
        "server/services/article-workflow/article-association-service.cjs:304",
        "server/services/article-workflow/article-association-service.cjs:308",
        "server/services/article-workflow/article-association-service.cjs:375",
        "server/services/release-governance/approval-state-machine-service.cjs:133",
        "server/services/release-governance/approval-state-machine-service.cjs:140",
        "server/services/release-governance/approval-state-machine-service.cjs:192",
        "server/services/release-governance/approval-state-machine-service.cjs:215",
        "server/services/release-governance/approval-state-machine-service.cjs:223"
      ]
    },
    "ARTICLE_SOURCE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:306"
      ]
    },
    "ARTICLE_SOURCE_OUTSIDE_ACTIVE_ROOT": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:79"
      ]
    },
    "ARTICLE_STANDARDIZATION_BLOCKED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:305"
      ]
    },
    "ARTICLE_VALIDATION_FAILED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:313",
        "server/services/release-governance/approval-state-machine-service.cjs:339"
      ]
    },
    "ARTICLE_WORKFLOW_ERROR": {
      "statuses": [],
      "sites": [
        "server/routes/article-workflow-routes.cjs:205"
      ]
    },
    "ARTICLE_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:96"
      ]
    },
    "ARTIFACT_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:158"
      ]
    },
    "AUTH_CODE_EXCHANGE_FAILED": {
      "statuses": [
        502
      ],
      "sites": [
        "server/shared/auth/oidc-method.cjs:110"
      ]
    },
    "AUTH_LOCAL_MODE": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/http-app.cjs:277",
        "server/shared/http-app.cjs:281"
      ]
    },
    "AUTH_STATE_MISMATCH": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/auth/oidc-method.cjs:103"
      ]
    },
    "BODY_NOT_ALLOWED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/http-app.cjs:193"
      ]
    },
    "BODY_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/http-app.cjs:195"
      ]
    },
    "BUILDER_UNAVAILABLE": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/snapshot-store-service.cjs:57"
      ]
    },
    "BUILD_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:135"
      ]
    },
    "CAPABILITY_CONSUMER_ANCHOR_INVALID": {
      "statuses": [
        422
      ],
      "sites": [
        "server/routes/ontology-routes.cjs:73",
        "server/services/schema-manager/schema-history-service.cjs:84",
        "server/services/schema-manager/schema-write-service.cjs:149"
      ]
    },
    "CHANGE_PREVIEW_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/enums-change-preview-service.cjs:150"
      ]
    },
    "CHANGE_PREVIEW_STALE": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/enums-change-preview-service.cjs:154"
      ]
    },
    "COMPONENT_NOT_REGISTERED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:203"
      ]
    },
    "CONFIRMATION_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:197",
        "server/services/article-workflow/article-workflow-service.cjs:282"
      ]
    },
    "CONFLICT_NOT_FOUND": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:109"
      ]
    },
    "CONFLICT_SOURCE_CHANGED": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:114"
      ]
    },
    "CONFLICT_STORE_CORRUPT": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:67",
        "server/services/inference/inference-conflict-store.cjs:70"
      ]
    },
    "CONTENT_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:323",
        "server/services/article-workflow/article-workflow-service.cjs:492"
      ]
    },
    "CURRENT_POINTER_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:27",
        "server/services/release-governance/release-reader-service.cjs:29"
      ]
    },
    "CURRENT_POINTER_MISMATCH": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:34"
      ]
    },
    "CURRENT_RELEASE_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:31"
      ]
    },
    "CYCLE_DETECTED": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:164"
      ]
    },
    "DERIVATION_REBUILD_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/data-roles-routes.cjs:81"
      ]
    },
    "DERIVED_SEGMENT_READ_ONLY": {
      "statuses": [
        403
      ],
      "sites": [
        "server/routes/enums-routes.cjs:122",
        "server/services/schema-manager/schema-write-service.cjs:252"
      ]
    },
    "DOCUMENT_INDEX_UNAVAILABLE": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-inventory-service.cjs:176",
        "server/services/projection/document-source-scanner.cjs:170",
        "server/services/projection/document-source-scanner.cjs:183"
      ]
    },
    "DOCUMENT_NOT_FOUND": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-inventory-service.cjs:223"
      ]
    },
    "DRAFT_ALREADY_EXISTS": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:139"
      ]
    },
    "DRAFT_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:42"
      ]
    },
    "DRAFT_PATH_ESCAPE": {
      "statuses": [],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:41"
      ]
    },
    "DUPLICATE_ARTICLE_ID": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:287",
        "server/services/article-workflow/article-workflow-service.cjs:414"
      ]
    },
    "DUPLICATE_ARTIFACT": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:64"
      ]
    },
    "DUPLICATE_DOCUMENT_ID": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-source-scanner.cjs:108"
      ]
    },
    "DUPLICATE_PRODUCT_ALIAS": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:65"
      ]
    },
    "EDGE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/routes/review-routes.cjs:47"
      ]
    },
    "ENTITY_COMPLIANCE_BLOCKED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:384",
        "server/services/entity-compliance/entity-repair-service.cjs:396",
        "server/services/entity-compliance/entity-repair-service.cjs:440",
        "server/services/entity-compliance/entity-repair-service.cjs:512",
        "server/services/entity-compliance/entity-repair-service.cjs:520",
        "server/services/release-governance/complete-release-artifact-service.cjs:485"
      ]
    },
    "ENTITY_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:90",
        "server/services/release-governance/entity-parent-service.cjs:211"
      ]
    },
    "ENTITY_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:224"
      ]
    },
    "ENUMS_PORT_UNAVAILABLE": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:127",
        "server/services/pipeline/version-registry-service.cjs:157"
      ]
    },
    "ENUMS_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/enums-change-preview-service.cjs:80",
        "server/services/schema-manager/enums-write-service.cjs:79",
        "server/services/schema-manager/enums-write-service.cjs:100"
      ]
    },
    "ENUMS_SEGMENT_UNREGISTERED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:140"
      ]
    },
    "ENUMS_SHAPE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:134"
      ]
    },
    "EXPECTATIONS_CORRUPT": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:545"
      ]
    },
    "FIELDS_RECIPE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/fields-write-service.cjs:105"
      ]
    },
    "FIELDS_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/fields-write-service.cjs:89"
      ]
    },
    "FIELD_NOT_ALLOWED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:401"
      ]
    },
    "FIELD_VALUE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:478"
      ]
    },
    "FORBIDDEN": {
      "statuses": [
        403
      ],
      "sites": [
        "server/routes/release-runtime-routes.cjs:64"
      ]
    },
    "FORMAL_ARTICLE_CATALOG_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:123"
      ]
    },
    "FORMAL_ARTICLE_IDENTITY_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:135"
      ]
    },
    "FORMAL_ARTICLE_ID_REQUIRED": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-identity.cjs:34"
      ]
    },
    "FORMAL_AUDIT_ARTIFACT_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:102"
      ]
    },
    "FORMAT_VERSION_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/shared/frozen-artifact-reader.cjs:113"
      ]
    },
    "FROZEN_ARTIFACT_NOT_REGISTERED": {
      "statuses": [],
      "sites": [
        "server/shared/frozen-artifact-reader.cjs:29"
      ]
    },
    "GAP_ALREADY_RESOLVED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/routes/kg-routes.cjs:460"
      ]
    },
    "GRAPH_UNAVAILABLE": {
      "statuses": [
        503
      ],
      "sites": [
        "server/routes/review-routes.cjs:44",
        "server/services/inference/inference-engine.cjs:102",
        "server/services/projection/impact-analysis-service.cjs:86"
      ]
    },
    "HUMAN_EDIT_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/shared/human-edit-guard.cjs:151",
        "server/shared/human-edit-guard.cjs:173",
        "server/shared/vault-io.cjs:156",
        "server/shared/vault-io.cjs:400"
      ]
    },
    "IDENTITY_ANCHOR_IMMUTABLE": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:167"
      ]
    },
    "IMPACT_ANALYSIS_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/dependency-impact-preview-service.cjs:70"
      ]
    },
    "INDEX_REBUILD_IN_PROGRESS": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-inventory-service.cjs:155",
        "server/services/projection/document-inventory-service.cjs:166"
      ]
    },
    "INTERNAL_ERROR": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/kg-routes.cjs:455",
        "server/routes/kg-routes.cjs:468",
        "server/routes/sync-routes.cjs:84",
        "server/shared/http-app.cjs:132",
        "server/shared/http-app.cjs:264"
      ]
    },
    "INVALID_ALIAS_TARGET": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:281"
      ]
    },
    "INVALID_ANOMALY": {
      "statuses": [],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:41",
        "server/services/anomaly/anomaly-workbench-service.cjs:61",
        "server/services/anomaly/anomaly-workbench-service.cjs:63",
        "server/services/anomaly/anomaly-workbench-service.cjs:65"
      ]
    },
    "INVALID_ANOMALY_SOURCE": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:216",
        "server/services/anomaly/anomaly-workbench-service.cjs:216"
      ]
    },
    "INVALID_ARTIFACT_CONTENT": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:69"
      ]
    },
    "INVALID_ARTIFACT_PATH": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:35",
        "server/services/release-governance/release-builder-service.cjs:39"
      ]
    },
    "INVALID_CATEGORY": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:51",
        "server/services/schema-manager/schema-write-service.cjs:114"
      ]
    },
    "INVALID_CONFLICT": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:19",
        "server/services/inference/inference-conflict-store.cjs:21",
        "server/services/inference/inference-conflict-store.cjs:26",
        "server/services/inference/inference-conflict-store.cjs:28",
        "server/services/inference/inference-conflict-store.cjs:30",
        "server/services/inference/inference-conflict-store.cjs:43",
        "server/services/inference/inference-conflict-store.cjs:44",
        "server/services/inference/inference-conflict-store.cjs:45",
        "server/services/inference/inference-conflict-store.cjs:46",
        "server/services/inference/inference-conflict-store.cjs:82"
      ]
    },
    "INVALID_CONFLICT_STORE": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:59"
      ]
    },
    "INVALID_DECISION": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:110",
        "server/services/release-governance/approval-state-machine-service.cjs:124"
      ]
    },
    "INVALID_DECISION_INPUT": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/inference/inference-decision-consumer.cjs:18"
      ]
    },
    "INVALID_DISCOVERY_DOMAIN": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:307"
      ]
    },
    "INVALID_DISCOVERY_GROUP": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:289",
        "server/services/schema-manager/schema-write-service.cjs:290"
      ]
    },
    "INVALID_DISCOVERY_LABEL": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:311"
      ]
    },
    "INVALID_DISCOVERY_PATCH": {
      "statuses": [
        400,
        404
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:255",
        "server/services/schema-manager/schema-write-service.cjs:300",
        "server/services/schema-manager/schema-write-service.cjs:346",
        "server/services/schema-manager/schema-write-service.cjs:357",
        "server/services/schema-manager/schema-write-service.cjs:366",
        "server/services/schema-manager/schema-write-service.cjs:519",
        "server/services/schema-manager/schema-write-service.cjs:588",
        "server/services/schema-manager/schema-write-service.cjs:590"
      ]
    },
    "INVALID_DOCUMENT": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-source-scanner.cjs:24",
        "server/services/projection/document-source-scanner.cjs:26",
        "server/services/projection/document-source-scanner.cjs:41",
        "server/services/projection/document-source-scanner.cjs:49"
      ]
    },
    "INVALID_DOCUMENT_IDENTITY": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-identity.cjs:9"
      ]
    },
    "INVALID_DRAFT_PATH": {
      "statuses": [],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:38"
      ]
    },
    "INVALID_FILE_NAME": {
      "statuses": [],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:730"
      ]
    },
    "INVALID_ONTOLOGY": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-engine.cjs:99"
      ]
    },
    "INVALID_PRODUCT_ALIAS": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:61",
        "server/services/pipeline/version-registry-service.cjs:64"
      ]
    },
    "INVALID_PRODUCT_ALIASES": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:57"
      ]
    },
    "INVALID_QUERY": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:265",
        "server/services/inference/inference-engine.cjs:103",
        "server/services/inference/inference-engine.cjs:104",
        "server/services/projection/architecture-version-service.cjs:164",
        "server/services/projection/architecture-version-service.cjs:181",
        "server/services/projection/document-inventory-service.cjs:113",
        "server/services/projection/impact-analysis-service.cjs:18",
        "server/services/projection/impact-analysis-service.cjs:24",
        "server/services/projection/impact-analysis-service.cjs:26",
        "server/services/projection/impact-analysis-service.cjs:30"
      ]
    },
    "INVALID_REGISTRY": {
      "statuses": [],
      "sites": [
        "server/services/projection/impact-analysis-service.cjs:13"
      ]
    },
    "INVALID_RELEASE_ARTIFACT": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:70",
        "server/services/release-governance/complete-release-artifact-service.cjs:100",
        "server/services/release-governance/complete-release-artifact-service.cjs:169",
        "server/services/release-governance/complete-release-artifact-service.cjs:202",
        "server/services/release-governance/complete-release-artifact-service.cjs:240"
      ]
    },
    "INVALID_RELEASE_ID": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:29"
      ]
    },
    "INVALID_REVIEW": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-conflict-store.cjs:104",
        "server/services/inference/inference-conflict-store.cjs:106",
        "server/services/inference/inference-conflict-store.cjs:112"
      ]
    },
    "INVALID_RULE_ID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:102"
      ]
    },
    "INVALID_RULE_PROPOSAL": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:87"
      ]
    },
    "INVALID_SNAPSHOT_ID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:75",
        "server/services/schema-manager/enums-write-service.cjs:85",
        "server/services/schema-manager/relations-write-service.cjs:142",
        "server/services/schema-manager/schema-history-service.cjs:48",
        "server/services/schema-manager/schema-history-service.cjs:64"
      ]
    },
    "INVALID_SOURCE_COMMIT": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:60",
        "server/services/release-governance/snapshot-store-service.cjs:60"
      ]
    },
    "INVALID_STRUCTURED_DECISION": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/inference/inference-decision-consumer.cjs:21",
        "server/services/inference/inference-decision-consumer.cjs:26"
      ]
    },
    "INVALID_VERSION": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/version-contract.cjs:24"
      ]
    },
    "INVALID_VERSION_LIST": {
      "statuses": [],
      "sites": [
        "server/shared/version-contract.cjs:46"
      ]
    },
    "INVALID_VERSION_PATH": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:31"
      ]
    },
    "INVALID_VERSION_PROJECTION": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:113",
        "server/services/pipeline/version-registry-service.cjs:224",
        "server/services/pipeline/version-registry-service.cjs:227",
        "server/services/projection/architecture-version-service.cjs:149"
      ]
    },
    "INVALID_VERSION_SNAPSHOT": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/projection/architecture-version-service.cjs:132",
        "server/services/projection/architecture-version-service.cjs:134"
      ]
    },
    "INVALID_VERSION_SNAPSHOT_PATH": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/projection/architecture-version-service.cjs:124"
      ]
    },
    "INVALID_VERSION_TYPE": {
      "statuses": [
        400
      ],
      "sites": [
        "server/shared/version-contract.cjs:20"
      ]
    },
    "LEGACY_DERIVED_PUSH_RETIRED": {
      "statuses": [
        410
      ],
      "sites": [
        "server/routes/sync-routes.cjs:33"
      ]
    },
    "LIFECYCLE_TRANSITION_INVALID": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:205"
      ]
    },
    "MISSING_CHILD_ID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/routes/ontology-routes.cjs:107"
      ]
    },
    "MISSING_PATCH": {
      "statuses": [
        400
      ],
      "sites": [
        "server/routes/ontology-routes.cjs:50",
        "server/routes/ontology-routes.cjs:104",
        "server/services/schema-manager/schema-write-service.cjs:117",
        "server/services/schema-manager/schema-write-service.cjs:165"
      ]
    },
    "NODE_NOT_FOUND": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-inventory-service.cjs:238"
      ]
    },
    "NON_ENTITY_TARGET": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:129"
      ]
    },
    "NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/routes/anomaly-workbench-routes.cjs:28"
      ]
    },
    "NOT_IN_PINNED_CONTEXT": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:46"
      ]
    },
    "NO_CURRENT_RELEASE": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:20",
        "server/services/release-governance/release-reader-service.cjs:26"
      ]
    },
    "NO_FRONTMATTER": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:216"
      ]
    },
    "OBSIDIAN_OPEN_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/pipeline/obsidian-open-service.cjs:56"
      ]
    },
    "OPERATOR_CONTEXT_NOT_CONFIGURED": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:453",
        "server/services/anomaly/anomaly-workbench-service.cjs:498"
      ]
    },
    "PATH_OUTSIDE_ALLOWED_ROOT": {
      "statuses": [],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:31",
        "server/services/article-workflow/article-workflow-service.cjs:686",
        "server/services/article-workflow/article-workflow-service.cjs:827"
      ]
    },
    "PERSISTENT_ISSUE_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:505",
        "server/services/anomaly/anomaly-workbench-service.cjs:520"
      ]
    },
    "PIPELINE_CANCEL_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/pipeline-routes.cjs:92"
      ]
    },
    "POST_CHECK_REGRESSION": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:321",
        "server/services/entity-compliance/entity-repair-service.cjs:433"
      ]
    },
    "PREVIEW_EXPIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:460",
        "server/services/entity-compliance/entity-repair-service.cjs:488"
      ]
    },
    "PREVIEW_NOT_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/enums-change-preview-service.cjs:86"
      ]
    },
    "PROJECTION_IDENTITY_UNMOUNTED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:198"
      ]
    },
    "PROMOTER_NOT_FOUND": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:201"
      ]
    },
    "PROMOTE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:219"
      ]
    },
    "PROMOTE_POSTCONDITION_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:223"
      ]
    },
    "PROMOTE_SPAWN_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:215"
      ]
    },
    "PROPOSAL_EDIT_NOT_AVAILABLE": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:481"
      ]
    },
    "PUBLISH_BUSY": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/release-publisher-service.cjs:210"
      ]
    },
    "PUBLISH_RELEASE_INVALID": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:515"
      ]
    },
    "PUBLISH_SOURCE_UNAVAILABLE": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:482"
      ]
    },
    "REASONING_CONFLICT_UNRESOLVED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/inference/inference-decision-consumer.cjs:30"
      ]
    },
    "REGISTRY_CHANGED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:469",
        "server/services/entity-compliance/entity-repair-service.cjs:495"
      ]
    },
    "RELATIONS_INVALID": {
      "statuses": [
        400,
        500
      ],
      "sites": [
        "server/routes/relations-routes.cjs:27",
        "server/services/schema-manager/relations-write-service.cjs:59",
        "server/services/schema-manager/relations-write-service.cjs:69",
        "server/services/schema-manager/relations-write-service.cjs:80",
        "server/services/schema-manager/relations-write-service.cjs:83",
        "server/services/schema-manager/relations-write-service.cjs:87",
        "server/services/schema-manager/relations-write-service.cjs:90",
        "server/services/schema-manager/relations-write-service.cjs:96",
        "server/services/schema-manager/relations-write-service.cjs:113"
      ]
    },
    "RELATIONS_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/relations-write-service.cjs:107",
        "server/services/schema-manager/relations-write-service.cjs:137"
      ]
    },
    "RELATION_CANDIDATE_AUTO_APPROVAL": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:74"
      ]
    },
    "RELATION_CANDIDATE_AUTO_REJECTION": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:116"
      ]
    },
    "RELATION_CANDIDATE_AUTO_WINNER": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:115"
      ]
    },
    "RELATION_CANDIDATE_HASH_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:134"
      ]
    },
    "RELATION_CANDIDATE_ID_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:132"
      ]
    },
    "RELATION_CANDIDATE_INVALID": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:16",
        "server/services/governance/relation-candidate-contract.cjs:27",
        "server/services/governance/relation-candidate-contract.cjs:33",
        "server/services/governance/relation-candidate-contract.cjs:114"
      ]
    },
    "RELATION_CANDIDATE_REQUIRED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:451"
      ]
    },
    "RELATION_CANDIDATE_STATUS_INVALID": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:138"
      ]
    },
    "RELATION_CANDIDATE_TYPE_DISABLED": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:92"
      ]
    },
    "RELATION_CONFLICT_GROUP_ID_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:123"
      ]
    },
    "RELATION_CONFLICT_GROUP_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:120"
      ]
    },
    "RELATION_DIRECTION_REQUIRED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:154"
      ]
    },
    "RELATION_EVIDENCE_ID_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:67"
      ]
    },
    "RELATION_EVIDENCE_INVALID": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:52"
      ]
    },
    "RELATION_EVIDENCE_MISSING": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:85"
      ]
    },
    "RELATION_REJECTION_REASON_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/anomaly/anomaly-workbench-service.cjs:455"
      ]
    },
    "RELATION_REVIEW_BLOCKED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/routes/review-routes.cjs:74"
      ]
    },
    "RELATION_REVIEW_STATE_FORBIDDEN": {
      "statuses": [],
      "sites": [
        "server/routes/review-routes.cjs:62"
      ]
    },
    "RELATION_TARGET_AMBIGUOUS": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:43"
      ]
    },
    "RELATION_TRIPLE_ID_MISMATCH": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:109"
      ]
    },
    "RELATION_TRIPLE_INVALID": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:73"
      ]
    },
    "RELATION_TRIPLE_MISSING": {
      "statuses": [],
      "sites": [
        "server/services/governance/relation-candidate-contract.cjs:118"
      ]
    },
    "RELATION_TYPE_UNREGISTERED": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:347"
      ]
    },
    "RELEASED_VERSION_IMMUTABLE": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:78",
        "server/services/pipeline/version-registry-service.cjs:88"
      ]
    },
    "RELEASE_ARTIFACT_HASH_MISMATCH": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:250"
      ]
    },
    "RELEASE_ARTIFACT_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:25",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:26",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:33",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:35",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:51",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:56",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:64",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:75",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:80",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:123"
      ]
    },
    "RELEASE_ARTIFACT_MISSING": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:76",
        "server/services/release-governance/complete-release-artifact-service.cjs:84",
        "server/services/release-governance/complete-release-artifact-service.cjs:95",
        "server/services/release-governance/complete-release-artifact-service.cjs:107",
        "server/services/release-governance/complete-release-artifact-service.cjs:437",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:45",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:190"
      ]
    },
    "RELEASE_CROSS_ARTICLE_DIRTY": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:403"
      ]
    },
    "RELEASE_DOCUMENT_INDEX_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:115",
        "server/services/release-governance/complete-release-artifact-service.cjs:119",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:100",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:105",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:109"
      ]
    },
    "RELEASE_IDENTITY_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:142"
      ]
    },
    "RELEASE_ID_LOCKED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/release-reader-service.cjs:48"
      ]
    },
    "RELEASE_INDEX_IMMUTABLE": {
      "statuses": [],
      "sites": [
        "server/services/projection/document-inventory-service.cjs:154",
        "server/services/projection/document-inventory-service.cjs:165"
      ]
    },
    "RELEASE_INPUT_MISMATCH": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:104"
      ]
    },
    "RELEASE_MANIFEST_ORPHAN": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:518"
      ]
    },
    "RELEASE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/release-builder-service.cjs:150"
      ]
    },
    "RELEASE_PROJECTION_IDENTITY_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/release-governance/complete-release-artifact-service.cjs:181",
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:129"
      ]
    },
    "RELEASE_READER_REQUIRED": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:136"
      ]
    },
    "RELEASE_RESTORE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/release-publisher-service.cjs:224"
      ]
    },
    "RELEASE_RESTORE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/release-publisher-service.cjs:226"
      ]
    },
    "REPAIR_APPLY_NOT_CONFIGURED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/routes/entity-compliance-routes.cjs:244"
      ]
    },
    "REPO_ROOT_REQUIRED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:32"
      ]
    },
    "RULES_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:95",
        "server/services/schema-profiling/rules-lifecycle-service.cjs:174"
      ]
    },
    "RULES_SERVICE_UNAVAILABLE": {
      "statuses": [
        503
      ],
      "sites": [
        "server/routes/rules-lifecycle-routes.cjs:19"
      ]
    },
    "RULE_ID_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:104"
      ]
    },
    "RULE_ID_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:167"
      ]
    },
    "RULE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:177"
      ]
    },
    "RULE_SEALED_UNTIL_WAVE4": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:100",
        "server/services/schema-profiling/rules-lifecycle-service.cjs:180"
      ]
    },
    "RULE_SHAPE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-profiling/rules-lifecycle-service.cjs:109"
      ]
    },
    "SCHEMA_BACKUP_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:76"
      ]
    },
    "SCHEMA_CANDIDATE_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:135"
      ]
    },
    "SCHEMA_FILE_MISSING": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:58"
      ]
    },
    "SCHEMA_PARSE_ERROR": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:65",
        "server/services/schema-manager/schema-write-service.cjs:593"
      ]
    },
    "SCHEMA_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/schema-history-service.cjs:58",
        "server/services/schema-manager/schema-write-service.cjs:124",
        "server/shared/theschema-write.cjs:28"
      ]
    },
    "SCHEMA_REVISION_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:189",
        "server/services/pipeline/version-registry-service.cjs:213",
        "server/services/pipeline/version-registry-service.cjs:293",
        "server/services/schema-profiling/rules-lifecycle-service.cjs:92",
        "server/services/schema-profiling/rules-lifecycle-service.cjs:171",
        "server/shared/schema-write-guards.cjs:55",
        "server/shared/theschema-write.cjs:22"
      ]
    },
    "SCHEMA_VALUE_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:266",
        "server/services/schema-manager/schema-write-service.cjs:277",
        "server/services/schema-manager/schema-write-service.cjs:302",
        "server/services/schema-manager/schema-write-service.cjs:315",
        "server/services/schema-manager/schema-write-service.cjs:371",
        "server/services/schema-manager/schema-write-service.cjs:526",
        "server/services/schema-manager/schema-write-service.cjs:534"
      ]
    },
    "SCHEMA_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:84"
      ]
    },
    "SCHEMA_WRITE_UNAVAILABLE": {
      "statuses": [
        503
      ],
      "sites": [
        "server/routes/dependencies-routes.cjs:35",
        "server/routes/enums-routes.cjs:110",
        "server/routes/enums-routes.cjs:140",
        "server/routes/ontology-routes.cjs:46",
        "server/routes/ontology-routes.cjs:100",
        "server/routes/schema-discovery-routes.cjs:235",
        "server/routes/version-registry-routes.cjs:26",
        "server/routes/version-registry-routes.cjs:38",
        "server/routes/version-registry-routes.cjs:51",
        "server/routes/version-registry-routes.cjs:63"
      ]
    },
    "SEED_NOT_FOUND": {
      "statuses": [],
      "sites": [
        "server/services/inference/inference-engine.cjs:109",
        "server/services/projection/impact-analysis-service.cjs:126"
      ]
    },
    "SELF_REFERENCE": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:114"
      ]
    },
    "SELF_RELATION_NOT_ALLOWED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:137",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:158"
      ]
    },
    "SEMANTIC_PROJECTION_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:210"
      ]
    },
    "SEMANTIC_PROJECTION_SELECTION_REQUIRED": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:207"
      ]
    },
    "SNAPSHOT_HASH_MISMATCH": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/snapshot-store-service.cjs:39"
      ]
    },
    "SNAPSHOT_INPUT_INVALID": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/snapshot-store-service.cjs:33"
      ]
    },
    "SNAPSHOT_INVALID": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:89",
        "server/services/schema-manager/relations-write-service.cjs:146",
        "server/services/schema-manager/schema-history-service.cjs:68"
      ]
    },
    "SNAPSHOT_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:86",
        "server/services/schema-manager/relations-write-service.cjs:143",
        "server/services/schema-manager/schema-history-service.cjs:65"
      ]
    },
    "SOURCE_ARCHIVE_MISMATCH": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:80"
      ]
    },
    "SOURCE_ARCHIVE_MISSING": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:56"
      ]
    },
    "SOURCE_CHANGED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:306",
        "server/services/entity-compliance/entity-repair-service.cjs:310",
        "server/services/entity-compliance/entity-repair-service.cjs:462",
        "server/services/entity-compliance/entity-repair-service.cjs:465",
        "server/services/entity-compliance/entity-repair-service.cjs:489",
        "server/services/entity-compliance/entity-repair-service.cjs:491",
        "server/services/entity-compliance/entity-repair-service.cjs:533"
      ]
    },
    "SOURCE_FILE_NOT_FOUND": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:67"
      ]
    },
    "SOURCE_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:99",
        "server/services/entity-compliance/entity-repair-service.cjs:104",
        "server/services/pipeline/obsidian-open-service.cjs:49"
      ]
    },
    "SOURCE_PATH_OUTSIDE_VAULT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:63",
        "server/services/article-workflow/article-draft-workflow.cjs:65"
      ]
    },
    "STALE_VERSION_SNAPSHOT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/projection/architecture-version-service.cjs:129"
      ]
    },
    "STATE_TRANSITION_FORBIDDEN": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:49",
        "server/services/release-governance/approval-state-machine-service.cjs:431",
        "server/shared/status-transition-guard.cjs:54"
      ]
    },
    "SUBJECT_NOT_MOUNTED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/shared/schema-config.cjs:73"
      ]
    },
    "SUBJECT_UNKNOWN": {
      "statuses": [
        404
      ],
      "sites": [
        "server/shared/schema-config.cjs:71"
      ]
    },
    "TASK_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:196"
      ]
    },
    "UNAUTHENTICATED": {
      "statuses": [
        401
      ],
      "sites": [
        "server/services/governance/local-operator-context.cjs:19"
      ]
    },
    "UNKNOWN_OPERATION": {
      "statuses": [
        400
      ],
      "sites": [
        "server/services/release-governance/approval-state-machine-service.cjs:47",
        "server/services/release-governance/approval-state-machine-service.cjs:525"
      ]
    },
    "UNKNOWN_PARENT": {
      "statuses": [],
      "sites": [
        "server/services/release-governance/entity-parent-service.cjs:121"
      ]
    },
    "UNSAFE_BODY_PATCH": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:99",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:119",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:142",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:180"
      ]
    },
    "UNSUPPORTED_FILE_TYPE": {
      "statuses": [
        415
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:732"
      ]
    },
    "UNSUPPORTED_RELATION_TYPE": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:56",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:78"
      ]
    },
    "UNSUPPORTED_RULE_ACTION": {
      "statuses": [
        400
      ],
      "sites": [
        "server/routes/rules-lifecycle-routes.cjs:24"
      ]
    },
    "UPLOAD_TOO_LARGE": {
      "statuses": [
        413
      ],
      "sites": [
        "server/services/article-workflow/article-workflow-service.cjs:739"
      ]
    },
    "VALIDATION_ERROR": {
      "statuses": [
        400,
        422,
        500
      ],
      "sites": [
        "server/routes/article-association-routes.cjs:38",
        "server/routes/enums-routes.cjs:114",
        "server/routes/enums-routes.cjs:127",
        "server/routes/kg-routes.cjs:438",
        "server/routes/kg-routes.cjs:443",
        "server/routes/obsidian-open-routes.cjs:18",
        "server/routes/ontology-routes.cjs:67",
        "server/routes/ontology-routes.cjs:76",
        "server/routes/pipeline-routes.cjs:43",
        "server/routes/pipeline-routes.cjs:63",
        "server/routes/property-routes.cjs:82",
        "server/routes/review-routes.cjs:39",
        "server/routes/review-routes.cjs:41",
        "server/routes/sync-routes.cjs:38",
        "server/routes/sync-routes.cjs:42",
        "server/routes/sync-routes.cjs:46",
        "server/routes/sync-routes.cjs:49",
        "server/routes/sync-routes.cjs:61",
        "server/routes/sync-routes.cjs:64",
        "server/routes/sync-routes.cjs:68",
        "server/services/article-workflow/article-association-service.cjs:30",
        "server/services/article-workflow/article-association-service.cjs:278",
        "server/services/article-workflow/article-draft-workflow.cjs:36",
        "server/services/article-workflow/article-workflow-service.cjs:201",
        "server/services/article-workflow/article-workflow-service.cjs:283",
        "server/services/article-workflow/article-workflow-service.cjs:397",
        "server/services/article-workflow/article-workflow-service.cjs:399",
        "server/services/article-workflow/article-workflow-service.cjs:405",
        "server/services/article-workflow/article-workflow-service.cjs:409",
        "server/services/article-workflow/article-workflow-service.cjs:728",
        "server/services/article-workflow/article-workflow-service.cjs:737",
        "server/services/article-workflow/article-workflow-service.cjs:740",
        "server/services/article-workflow/article-workflow-service.cjs:836",
        "server/services/article-workflow/article-workflow-service.cjs:836",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:90",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:93",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:95",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:115",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:116",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:135",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:138",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:156",
        "server/services/entity-compliance/entity-repair-service.cjs:91",
        "server/services/entity-compliance/entity-repair-service.cjs:100",
        "server/services/entity-compliance/entity-repair-service.cjs:106",
        "server/services/entity-compliance/entity-repair-service.cjs:111",
        "server/services/entity-compliance/entity-repair-service.cjs:113",
        "server/services/entity-compliance/entity-repair-service.cjs:121",
        "server/services/entity-compliance/entity-repair-service.cjs:125",
        "server/services/entity-compliance/entity-repair-service.cjs:127",
        "server/services/entity-compliance/entity-repair-service.cjs:132",
        "server/services/entity-compliance/entity-repair-service.cjs:133",
        "server/services/entity-compliance/entity-repair-service.cjs:139",
        "server/services/entity-compliance/entity-repair-service.cjs:149",
        "server/services/entity-compliance/entity-repair-service.cjs:150",
        "server/services/entity-compliance/entity-repair-service.cjs:160",
        "server/services/entity-compliance/entity-repair-service.cjs:163",
        "server/services/entity-compliance/entity-repair-service.cjs:164",
        "server/services/entity-compliance/entity-repair-service.cjs:165",
        "server/services/entity-compliance/entity-repair-service.cjs:166",
        "server/services/entity-compliance/entity-repair-service.cjs:167",
        "server/services/entity-compliance/entity-repair-service.cjs:171",
        "server/services/entity-compliance/entity-repair-service.cjs:189",
        "server/services/entity-compliance/entity-repair-service.cjs:191",
        "server/services/entity-compliance/entity-repair-service.cjs:194",
        "server/services/entity-compliance/entity-repair-service.cjs:204",
        "server/services/entity-compliance/entity-repair-service.cjs:205",
        "server/services/entity-compliance/entity-repair-service.cjs:207",
        "server/services/entity-compliance/entity-repair-service.cjs:304",
        "server/services/entity-compliance/entity-repair-service.cjs:313",
        "server/services/entity-compliance/entity-repair-service.cjs:315",
        "server/services/entity-compliance/entity-repair-service.cjs:361",
        "server/services/entity-compliance/entity-repair-service.cjs:458",
        "server/services/entity-compliance/entity-repair-service.cjs:486",
        "server/services/governance/action-approval-store.cjs:68",
        "server/services/governance/action-approval-store.cjs:69",
        "server/services/governance/action-approval-store.cjs:70",
        "server/services/governance/action-approval-store.cjs:87",
        "server/services/governance/action-approval-store.cjs:88",
        "server/services/pipeline/obsidian-open-service.cjs:15",
        "server/services/pipeline/obsidian-open-service.cjs:18",
        "server/services/pipeline/obsidian-open-service.cjs:22",
        "server/services/pipeline/obsidian-open-service.cjs:25",
        "server/services/pipeline/obsidian-open-service.cjs:47",
        "server/services/pipeline/version-registry-service.cjs:196",
        "server/services/release-governance/release-publisher-service.cjs:221",
        "server/services/schema-manager/dependencies-write-service.cjs:254",
        "server/services/schema-manager/dependency-impact-preview-service.cjs:51",
        "server/services/schema-manager/enums-write-service.cjs:128",
        "server/services/schema-manager/fields-write-service.cjs:91",
        "server/services/schema-manager/fields-write-service.cjs:95",
        "server/services/schema-manager/schema-history-service.cjs:77",
        "server/services/schema-manager/schema-history-service.cjs:81",
        "server/services/schema-manager/schema-write-service.cjs:142",
        "server/services/schema-manager/schema-write-service.cjs:146",
        "server/services/schema-manager/schema-write-service.cjs:433",
        "server/services/schema-manager/schema-write-service.cjs:434",
        "server/shared/status-transition-guard.cjs:50"
      ]
    },
    "VALIDATION_OUTPUT_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:183"
      ]
    },
    "VALIDATION_SPAWN_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:180"
      ]
    },
    "VALIDATION_STAMP_UNWRITABLE": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/article-workflow/validation-stamp-service.cjs:25"
      ]
    },
    "VALIDATOR_NOT_FOUND": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/article-workflow/article-draft-workflow.cjs:173"
      ]
    },
    "VALIDATOR_UNAVAILABLE": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/article-workflow/validation-stamp-service.cjs:19",
        "server/services/release-governance/approval-state-machine-service.cjs:309",
        "server/services/release-governance/approval-state-machine-service.cjs:331"
      ]
    },
    "VAULT_ID_MISMATCH": {
      "statuses": [
        422
      ],
      "sites": [
        "server/routes/sync-routes.cjs:54"
      ]
    },
    "VAULT_REVISION_CONFLICT": {
      "statuses": [],
      "sites": [
        "server/shared/vault-io.cjs:95"
      ]
    },
    "VAULT_REVISION_CREDENTIAL_REQUIRED": {
      "statuses": [],
      "sites": [
        "server/shared/vault-io.cjs:87"
      ]
    },
    "VERSIONS_REVISION_CONFLICT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:192",
        "server/services/pipeline/version-registry-service.cjs:215",
        "server/services/pipeline/version-registry-service.cjs:295"
      ]
    },
    "VERSION_ALREADY_RELEASED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:219"
      ]
    },
    "VERSION_NOT_ALLOWED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:27"
      ]
    },
    "VERSION_NOT_DRAFT": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:220"
      ]
    },
    "VERSION_NOT_FOUND": {
      "statuses": [
        404
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:218",
        "server/services/pipeline/version-registry-service.cjs:298",
        "server/services/projection/architecture-version-service.cjs:106"
      ]
    },
    "VERSION_NOT_REGISTERED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/article-workflow/article-association-service.cjs:208",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:31",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:32"
      ]
    },
    "VERSION_NOT_RELEASED": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:299"
      ]
    },
    "VERSION_PROJECTION_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:111"
      ]
    },
    "VERSION_PROJECTION_MISSING": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/release-governance/formal-knowledge-consumer-service.cjs:228"
      ]
    },
    "VERSION_PROJECTOR_NOT_FOUND": {
      "statuses": [
        503
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:100",
        "server/services/projection/architecture-version-service.cjs:146"
      ]
    },
    "VERSION_RANGE_INVALID": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:28",
        "server/services/entity-compliance/entity-relation-patch-service.cjs:29"
      ]
    },
    "VERSION_RANGE_INVERTED": {
      "statuses": [
        422
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:33"
      ]
    },
    "VERSION_REGISTRY_PORT_UNAVAILABLE": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/schema-write-service.cjs:106"
      ]
    },
    "VERSION_REGISTRY_UNAVAILABLE": {
      "statuses": [
        422,
        503
      ],
      "sites": [
        "server/services/entity-compliance/entity-relation-patch-service.cjs:30",
        "server/services/projection/architecture-version-service.cjs:99"
      ]
    },
    "VERSION_SNAPSHOT_ALREADY_EXISTS": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:268"
      ]
    },
    "VERSION_SNAPSHOT_MISSING": {
      "statuses": [
        409
      ],
      "sites": [
        "server/services/projection/architecture-version-service.cjs:122",
        "server/services/projection/architecture-version-service.cjs:125"
      ]
    },
    "VERSION_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/pipeline/version-registry-service.cjs:43",
        "server/services/pipeline/version-registry-service.cjs:52"
      ]
    },
    "WORKING_ARTIFACT_READ_FAILED": {
      "statuses": [],
      "sites": [
        "server/shared/working-artifact-snapshot.cjs:36"
      ]
    },
    "WORKING_JSON_INVALID": {
      "statuses": [
        500
      ],
      "sites": [
        "server/shared/frozen-artifact-reader.cjs:95",
        "server/shared/working-artifact-snapshot.cjs:77"
      ]
    },
    "WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/entity-compliance/entity-repair-service.cjs:526",
        "server/services/entity-compliance/entity-repair-service.cjs:534"
      ]
    },
    "YAML_PARSE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/dependencies-write-service.cjs:68",
        "server/services/schema-manager/enums-write-service.cjs:48",
        "server/services/schema-manager/ontology-write-service.cjs:29",
        "server/services/schema-manager/relations-write-service.cjs:35",
        "server/shared/version-registry-reader.cjs:39"
      ]
    },
    "YAML_WRITE_FAILED": {
      "statuses": [
        500
      ],
      "sites": [
        "server/services/schema-manager/enums-write-service.cjs:149",
        "server/services/schema-manager/relations-write-service.cjs:122"
      ]
    }
  }
};
