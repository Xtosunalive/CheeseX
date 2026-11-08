'use strict';

const APPROVED = 'approved';
const RETIRED = 'retired';
const LIFECYCLE_STATUSES = new Set(
  require('../../contracts/object-meta-model.json').layers.status.enums.lifecycle_status
    .map((entry) => entry.value),
);

// fields.yaml owns field types and reference targets. Class bindings may only
// describe how a class uses a field, never redefine what that field is.
const FORBIDDEN_BINDING_KEYS = [
  'type',
  'field_type',
  'value_type',
  'class',
  'class_id',
  'element_type',
  'element_kind',
  'reference_type',
  'source_type',
  'source_types',
  'target_type',
  'target_types',
  'value_domain',
  'aliases',
];

class OntologyInheritanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OntologyInheritanceError';
    this.code = code;
    this.details = clone(details);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).map((key) => [key, clone(value[key])]),
    );
  }
  return value;
}

function fail(code, message, details) {
  throw new OntologyInheritanceError(code, message, details);
}

function lifecycleOf(definition, elementType, elementId) {
  if (!isRecord(definition)) {
    fail('INVALID_ELEMENT_DEFINITION', `${elementType} ${elementId} must be an object`, {
      element_type: elementType,
      element_id: elementId,
    });
  }

  const status = definition.lifecycle_status === undefined
    ? APPROVED
    : definition.lifecycle_status;
  if (!LIFECYCLE_STATUSES.has(status)) {
    fail('INVALID_LIFECYCLE_STATUS', `Unknown lifecycle_status for ${elementType} ${elementId}`, {
      element_type: elementType,
      element_id: elementId,
      lifecycle_status: status,
    });
  }
  return status;
}

function nodeTypesOf(ontology) {
  if (!isRecord(ontology)) {
    fail('INVALID_ONTOLOGY', 'Ontology must be an object');
  }
  if (ontology.node_types === undefined) {
    return {};
  }
  if (!isRecord(ontology.node_types)) {
    fail('INVALID_NODE_TYPES', 'ontology.node_types must be an object');
  }
  return ontology.node_types;
}

function relationTypesOf(ontology) {
  if (ontology.relation_types === undefined) {
    return {};
  }
  if (!isRecord(ontology.relation_types)) {
    fail('INVALID_RELATION_TYPES', 'ontology.relation_types must be an object');
  }
  return ontology.relation_types;
}

function resolveClassChain(nodeTypes, classId) {
  if (typeof classId !== 'string' || classId.length === 0) {
    fail('INVALID_CLASS_ID', 'classId must be a non-empty string', { class_id: classId });
  }
  if (!hasOwn(nodeTypes, classId) || !isRecord(nodeTypes[classId])) {
    fail('UNKNOWN_CLASS', `Unknown class ${classId}`, { class_id: classId });
  }

  const childToRoot = [];
  const visited = new Set();
  let currentId = classId;

  while (true) {
    if (visited.has(currentId)) {
      fail('INHERITANCE_CYCLE', `Inheritance cycle includes ${currentId}`, {
        requested_class_id: classId,
        class_id: currentId,
        child_to_root: childToRoot.slice(),
      });
    }
    visited.add(currentId);

    const definition = nodeTypes[currentId];
    if (!isRecord(definition)) {
      fail('UNKNOWN_PARENT_CLASS', `Parent class ${currentId} is not a valid definition`, {
        requested_class_id: classId,
        parent_id: currentId,
      });
    }

    const status = lifecycleOf(definition, 'class', currentId);
    if (status !== APPROVED) {
      fail('NON_APPROVED_CLASS_IN_CHAIN', `Class ${currentId} is not approved`, {
        requested_class_id: classId,
        class_id: currentId,
        lifecycle_status: status,
      });
    }
    childToRoot.push(currentId);

    if (!hasOwn(definition, 'subClassOf') || definition.subClassOf === undefined) {
      break;
    }

    const parentId = definition.subClassOf;
    if (Array.isArray(parentId)) {
      fail('MULTIPLE_PARENTS', `Class ${currentId} must declare at most one parent`, {
        class_id: currentId,
        parents: parentId,
      });
    }
    if (typeof parentId !== 'string' || parentId.length === 0) {
      fail('INVALID_SUB_CLASS_OF', `Class ${currentId} has an invalid subClassOf`, {
        class_id: currentId,
        subClassOf: parentId,
      });
    }
    if (parentId === currentId) {
      fail('SELF_INHERITANCE', `Class ${currentId} cannot inherit from itself`, {
        class_id: currentId,
      });
    }
    if (!hasOwn(nodeTypes, parentId) || !isRecord(nodeTypes[parentId])) {
      fail('UNKNOWN_PARENT_CLASS', `Class ${currentId} references unknown parent ${parentId}`, {
        class_id: currentId,
        parent_id: parentId,
      });
    }

    currentId = parentId;
  }

  return childToRoot.reverse();
}

function fieldDefinitionsOf(fields) {
  if (fields === undefined || fields === null) {
    return null;
  }

  let definitions;
  if (Array.isArray(fields)) {
    definitions = fields;
  } else if (isRecord(fields) && Array.isArray(fields.fields)) {
    definitions = fields.fields;
  } else if (isRecord(fields) && isRecord(fields.fields)) {
    definitions = Object.entries(fields.fields)
      .map(([name, definition]) => ({ name, ...definition }));
  } else if (isRecord(fields)) {
    definitions = Object.entries(fields)
      .map(([name, definition]) => ({ name, ...definition }));
  } else {
    fail('INVALID_FIELDS', 'fields must be a fields.yaml object, an array, or a field map');
  }

  const result = new Map();
  for (const definition of definitions) {
    if (isRecord(definition) && typeof definition.name === 'string') {
      result.set(definition.name, definition);
    }
  }
  return result;
}

function composeDataProperties(chain, nodeTypes, fields) {
  const fieldDefinitions = fieldDefinitionsOf(fields);
  const states = new Map();

  for (const classId of chain) {
    const definition = nodeTypes[classId];
    if (definition.data_properties === undefined) {
      continue;
    }
    if (!isRecord(definition.data_properties)) {
      fail('INVALID_DATA_PROPERTIES', `Class ${classId} data_properties must be an object`, {
        class_id: classId,
      });
    }

    for (const fieldName of Object.keys(definition.data_properties)) {
      const binding = definition.data_properties[fieldName];
      if (!isRecord(binding)) {
        fail('INVALID_DATA_PROPERTY_BINDING', `Binding ${classId}.${fieldName} must be an object`, {
          class_id: classId,
          field_name: fieldName,
        });
      }

      for (const key of FORBIDDEN_BINDING_KEYS) {
        if (hasOwn(binding, key)) {
          fail('ILLEGAL_DATA_PROPERTY_REDEFINITION', `Binding ${classId}.${fieldName} cannot redefine ${key}`, {
            class_id: classId,
            field_name: fieldName,
            forbidden_key: key,
          });
        }
      }

      if (!fieldDefinitions) {
        fail('FIELD_DEFINITIONS_REQUIRED', `Class ${classId} bindings require fields.yaml definitions`, {
          class_id: classId,
          field_name: fieldName,
        });
      }
      if (!fieldDefinitions.has(fieldName)) {
        fail('UNKNOWN_DATA_PROPERTY', `Class ${classId} binds unknown field ${fieldName}`, {
          class_id: classId,
          field_name: fieldName,
        });
      }

      const previous = states.get(fieldName);
      const overrideChain = previous ? previous.override_chain.slice() : [];
      overrideChain.push({ class_id: classId, binding: clone(binding) });
      states.set(fieldName, {
        binding: clone(binding),
        source_class: classId,
        override_chain: overrideChain,
      });
    }
  }

  return Object.fromEntries(Array.from(states, ([fieldName, state]) => {
    const fieldDefinition = fieldDefinitions ? fieldDefinitions.get(fieldName) : null;
    const type = fieldDefinition && hasOwn(fieldDefinition, 'type')
      ? clone(fieldDefinition.type)
      : null;
    return [fieldName, {
      type,
      binding: clone(state.binding),
      source_class: state.source_class,
      override_chain: clone(state.override_chain),
    }];
  }));
}

function composeRelations(chain, nodeTypes, relationTypes) {
  let relationIds = [];
  let sourceClass = null;
  const overrideChain = [];

  for (const classId of chain) {
    const definition = nodeTypes[classId];
    if (!hasOwn(definition, 'allows_relations') || definition.allows_relations === undefined) {
      continue;
    }
    if (!Array.isArray(definition.allows_relations)
      || definition.allows_relations.some((id) => typeof id !== 'string')) {
      fail('INVALID_ALLOWS_RELATIONS', `Class ${classId} allows_relations must be a string array`, {
        class_id: classId,
      });
    }

    relationIds = clone(definition.allows_relations);
    sourceClass = classId;
    overrideChain.push({ class_id: classId, relation_ids: clone(relationIds) });
  }

  for (const relationId of relationIds) {
    if (!hasOwn(relationTypes, relationId) || !isRecord(relationTypes[relationId])) {
      fail('UNKNOWN_RELATION', `Class ${sourceClass} allows unknown relation ${relationId}`, {
        class_id: sourceClass,
        relation_id: relationId,
      });
    }
    const status = lifecycleOf(relationTypes[relationId], 'relation', relationId);
    if (status !== APPROVED) {
      fail('NON_APPROVED_RELATION', `Relation ${relationId} is not approved`, {
        class_id: sourceClass,
        relation_id: relationId,
        lifecycle_status: status,
      });
    }
  }

  return {
    relation_ids: clone(relationIds),
    source_class: sourceClass,
    override_chain: clone(overrideChain),
  };
}

function collectConstraints(ontology, chain) {
  if (ontology.constraints === undefined) {
    return [];
  }
  if (!Array.isArray(ontology.constraints)) {
    fail('INVALID_CONSTRAINTS', 'ontology.constraints must be an array');
  }

  const result = [];
  for (const classId of chain) {
    for (const definition of ontology.constraints) {
      if (!isRecord(definition)) {
        fail('INVALID_CONSTRAINT', 'Every constraint must be an object');
      }
      if (definition.class_id !== classId) {
        continue;
      }
      if (lifecycleOf(definition, 'constraint', definition.id || '<anonymous>') !== APPROVED) {
        continue;
      }
      result.push({
        id: definition.id === undefined ? null : definition.id,
        class_id: classId,
        source_class: classId,
        definition: clone(definition),
      });
    }
  }
  return result;
}

function collectActions(ontology, chain) {
  if (ontology.action_types === undefined) {
    return [];
  }
  if (!isRecord(ontology.action_types)) {
    fail('INVALID_ACTION_TYPES', 'ontology.action_types must be an object');
  }

  const result = [];
  for (const classId of chain) {
    for (const actionId of Object.keys(ontology.action_types)) {
      const definition = ontology.action_types[actionId];
      if (!isRecord(definition)) {
        fail('INVALID_ACTION_TYPE', `Action ${actionId} must be an object`, { action_id: actionId });
      }
      if (definition.class_id !== classId) {
        continue;
      }
      if (lifecycleOf(definition, 'action', actionId) !== APPROVED) {
        continue;
      }
      result.push({
        id: actionId,
        class_id: classId,
        source_class: classId,
        definition: clone(definition),
      });
    }
  }
  return result;
}

function resolveClassInheritance(ontology, classId, fields) {
  const nodeTypes = nodeTypesOf(ontology);
  const chain = resolveClassChain(nodeTypes, classId);

  return {
    class_id: classId,
    lifecycle_status: APPROVED,
    inheritance_chain: chain.slice(),
    data_properties: composeDataProperties(chain, nodeTypes, fields),
    allows_relations: composeRelations(chain, nodeTypes, relationTypesOf(ontology)),
    constraints: collectConstraints(ontology, chain),
    action_types: collectActions(ontology, chain),
  };
}

function resolveOntologyInheritance(ontology, fields) {
  const nodeTypes = nodeTypesOf(ontology);
  const resolved = [];

  for (const classId of Object.keys(nodeTypes)) {
    if (lifecycleOf(nodeTypes[classId], 'class', classId) !== APPROVED) {
      continue;
    }
    resolved.push([classId, resolveClassInheritance(ontology, classId, fields)]);
  }
  return Object.fromEntries(resolved);
}

function normalizeRetiredReference(registry, originalId, options = {}) {
  if (!isRecord(registry)) {
    fail('INVALID_REGISTRY', 'Retirement normalization registry must be an object');
  }
  if (typeof originalId !== 'string' || originalId.length === 0) {
    fail('INVALID_ELEMENT_ID', 'originalId must be a non-empty string', { original_id: originalId });
  }
  if (!isRecord(options)) {
    fail('INVALID_NORMALIZATION_OPTIONS', 'Normalization options must be an object');
  }

  const elementType = options.elementType;
  const registries = options.registries;

  function definitionAt(id, original) {
    if (hasOwn(registry, id)) {
      const definition = registry[id];
      if (!isRecord(definition)) {
        fail('INVALID_ELEMENT_DEFINITION', `Element ${id} must be an object`, { element_id: id });
      }
      if (elementType !== undefined
        && definition.element_type !== undefined
        && definition.element_type !== elementType) {
        fail('CROSS_TYPE_REPLACEMENT', `Element ${id} has a different element type`, {
          expected_element_type: elementType,
          actual_element_type: definition.element_type,
          element_id: id,
        });
      }
      return definition;
    }

    if (isRecord(registries)) {
      for (const candidateType of Object.keys(registries)) {
        if (candidateType === elementType || !isRecord(registries[candidateType])) {
          continue;
        }
        if (hasOwn(registries[candidateType], id)) {
          fail('CROSS_TYPE_REPLACEMENT', `Replacement ${id} belongs to another element type`, {
            expected_element_type: elementType,
            actual_element_type: candidateType,
            element_id: id,
          });
        }
      }
    }

    fail(original ? 'UNKNOWN_ELEMENT' : 'DANGLING_REPLACEMENT', `Cannot resolve element ${id}`, {
      element_id: id,
      original_id: originalId,
    });
  }

  const chain = [originalId];
  const visited = new Set();
  let currentId = originalId;

  try {
    while (true) {
      if (visited.has(currentId)) {
        fail('REPLACEMENT_CYCLE', `Replacement cycle includes ${currentId}`, {
          element_id: currentId,
        });
      }
      visited.add(currentId);

      const definition = definitionAt(currentId, currentId === originalId);
      const status = lifecycleOf(definition, 'element', currentId);
      if (status === APPROVED) {
        return {
          original_id: originalId,
          resolved_id: currentId,
          replacement_chain: chain.slice(),
        };
      }
      if (status !== RETIRED) {
        fail('NO_APPROVED_REPLACEMENT', `Replacement chain reaches non-active element ${currentId}`, {
          element_id: currentId,
          lifecycle_status: status,
        });
      }

      const replacedBy = isRecord(definition.retirement)
        ? definition.retirement.replaced_by
        : undefined;
      if (typeof replacedBy !== 'string' || replacedBy.length === 0) {
        fail('MISSING_REPLACEMENT', `Retired element ${currentId} has no replaced_by target`, {
          element_id: currentId,
        });
      }
      chain.push(replacedBy);
      if (replacedBy === currentId) {
        fail('REPLACEMENT_SELF_REFERENCE', `Retired element ${currentId} replaces itself`, {
          element_id: currentId,
        });
      }

      currentId = replacedBy;
    }
  } catch (error) {
    if (error instanceof OntologyInheritanceError) {
      error.details = { ...error.details, original_id: originalId, replacement_chain: chain.slice() };
    }
    throw error;
  }
}

function reconcileRetirementReferences(registry, options = {}) {
  if (!isRecord(registry)) {
    fail('INVALID_REGISTRY', 'Retirement reconciliation registry must be an object');
  }
  if (!isRecord(options)) {
    fail('INVALID_NORMALIZATION_OPTIONS', 'Normalization options must be an object');
  }
  const ids = Object.keys(registry).sort();
  // 元素 ID 允许与对象原型同名，逐项用 Map 承载，收尾再以自有数据属性落到普通对象
  const entries = new Map();

  for (const id of ids) {
    const definition = registry[id];
    const status = lifecycleOf(definition, 'element', id);
    const normalized = status === APPROVED || status === RETIRED
      ? normalizeRetiredReference(registry, id, options)
      : null;
    entries.set(id, {
      replaced_by: status === RETIRED ? definition.retirement.replaced_by : null,
      resolved_id: normalized ? normalized.resolved_id : null,
      replacement_chain: normalized ? normalized.replacement_chain : [],
      direct_replacers: [],
      transitive_replacers: [],
    });
  }

  for (const id of ids) {
    const entry = entries.get(id);
    const directTarget = entry.replaced_by;
    if (directTarget !== null) {
      const target = entries.get(directTarget);
      if (!target) {
        fail('DANGLING_REPLACEMENT', `Cannot reconcile replacement ${directTarget}`, {
          element_id: id,
          replacement_id: directTarget,
        });
      }
      target.direct_replacers.push(id);
    }
    for (const targetId of entry.replacement_chain.slice(1)) {
      const target = entries.get(targetId);
      if (!target) {
        fail('DANGLING_REPLACEMENT', `Cannot reconcile replacement ${targetId}`, {
          element_id: id,
          replacement_id: targetId,
        });
      }
      target.transitive_replacers.push(id);
    }
  }

  const elements = {};
  for (const [id, entry] of entries) {
    Object.defineProperty(elements, id, { value: entry, enumerable: true, writable: true, configurable: true });
  }

  return { elements };
}

module.exports = {
  OntologyInheritanceError,
  resolveClassInheritance,
  resolveOntologyInheritance,
  normalizeRetiredReference,
  reconcileRetirementReferences,
  fieldDefinitionsOf,
  FORBIDDEN_BINDING_KEYS,
};
