'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OntologyInheritanceError,
  resolveClassInheritance,
  resolveOntologyInheritance,
  normalizeRetiredReference,
  reconcileRetirementReferences,
} = require('../ontology-inheritance-resolver.cjs');

function expectError(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof OntologyInheritanceError);
    assert.strictEqual(error.code, code);
    return true;
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

function richOntology() {
  return {
    node_types: {
      Root: {
        data_properties: {
          title: { required: true, default: 'root title' },
          root_only: { default: 'root' },
        },
        allows_relations: ['R_ROOT'],
      },
      Mid: {
        subClassOf: 'Root',
        data_properties: {
          title: { required: false, validation: { min: 1 } },
          mid_only: { default: 'mid' },
        },
        allows_relations: ['R_MID'],
      },
      Leaf: {
        subClassOf: 'Mid',
        data_properties: {
          title: { permission: 'private' },
        },
      },
    },
    relation_types: {
      R_ROOT: {},
      R_MID: { lifecycle_status: 'approved' },
    },
    constraints: [
      { id: 'root_ready', class_id: 'Root', check: 'root.ready' },
      { id: 'mid_draft', class_id: 'Mid', lifecycle_status: 'draft' },
      { id: 'mid_reserved', class_id: 'Mid', lifecycle_status: 'reserved' },
      { id: 'leaf_submitted', class_id: 'Leaf', lifecycle_status: 'submitted' },
      { id: 'root_retired', class_id: 'Root', lifecycle_status: 'retired' },
      { id: 'other_class', class_id: 'Other' },
      { id: 'legacy_global', check: 'global' },
      { id: 'leaf_ready', class_id: 'Leaf', check: 'leaf.ready' },
    ],
    action_types: {
      root_action: { class_id: 'Root', input_schema: { type: 'object' } },
      mid_draft_action: { class_id: 'Mid', lifecycle_status: 'draft' },
      mid_reserved_action: { class_id: 'Mid', lifecycle_status: 'reserved' },
      leaf_submitted_action: { class_id: 'Leaf', lifecycle_status: 'submitted' },
      leaf_retired_action: { class_id: 'Leaf', lifecycle_status: 'retired' },
      other_action: { class_id: 'Other' },
      leaf_action: { class_id: 'Leaf', input_schema: { type: 'object' } },
    },
    risk_types: {
      high_risk: { action_ids: ['leaf_action'], level: 'high' },
    },
  };
}

function richFields() {
  return {
    fields: [
      { name: 'title', type: 'string' },
      { name: 'root_only', type: 'string' },
      { name: 'mid_only', type: 'string' },
    ],
  };
}

test('多跳继承按根到子合成，属性整体覆盖并保留来源与覆盖链', () => {
  const result = resolveClassInheritance(richOntology(), 'Leaf', richFields());

  assert.strictEqual(result.class_id, 'Leaf');
  assert.strictEqual(result.lifecycle_status, 'approved');
  assert.deepStrictEqual(result.inheritance_chain, ['Root', 'Mid', 'Leaf']);

  assert.strictEqual(result.data_properties.title.type, 'string');
  assert.deepStrictEqual(result.data_properties.title.binding, { permission: 'private' });
  assert.strictEqual(result.data_properties.title.source_class, 'Leaf');
  assert.deepStrictEqual(
    result.data_properties.title.override_chain.map((entry) => entry.class_id),
    ['Root', 'Mid', 'Leaf'],
  );
  assert.deepStrictEqual(result.data_properties.title.override_chain[0].binding, {
    required: true,
    default: 'root title',
  });
  assert.strictEqual(result.data_properties.root_only.source_class, 'Root');
  assert.strictEqual(result.data_properties.mid_only.source_class, 'Mid');
});

test('关系采用最近声明整体替换，约束和动作只收集现役父链成员，风险不解析', () => {
  const result = resolveClassInheritance(richOntology(), 'Leaf', richFields());

  assert.deepStrictEqual(result.allows_relations.relation_ids, ['R_MID']);
  assert.strictEqual(result.allows_relations.source_class, 'Mid');
  assert.deepStrictEqual(result.allows_relations.override_chain, [
    { class_id: 'Root', relation_ids: ['R_ROOT'] },
    { class_id: 'Mid', relation_ids: ['R_MID'] },
  ]);

  assert.deepStrictEqual(result.constraints.map((entry) => entry.id), [
    'root_ready',
    'leaf_ready',
  ]);
  assert.deepStrictEqual(result.constraints.map((entry) => entry.source_class), [
    'Root',
    'Leaf',
  ]);
  assert.deepStrictEqual(result.action_types.map((entry) => entry.id), [
    'root_action',
    'leaf_action',
  ]);
  assert.deepStrictEqual(result.action_types.map((entry) => entry.source_class), [
    'Root',
    'Leaf',
  ]);
  assert.strictEqual(hasOwn(result, 'risk_types'), false);
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

test('存量类缺省为 approved 独立根类，显式空关系列表可整体替换父类声明', () => {
  const legacy = resolveClassInheritance({
    node_types: { Legacy: { description: 'existing shape' } },
  }, 'Legacy');

  assert.strictEqual(legacy.lifecycle_status, 'approved');
  assert.deepStrictEqual(legacy.inheritance_chain, ['Legacy']);
  assert.deepStrictEqual(legacy.data_properties, {});
  assert.deepStrictEqual(legacy.allows_relations, {
    relation_ids: [],
    source_class: null,
    override_chain: [],
  });

  const replaced = resolveClassInheritance({
    node_types: {
      Root: { allows_relations: ['OLD'] },
      Child: { subClassOf: 'Root', allows_relations: [] },
    },
    relation_types: {
      OLD: { lifecycle_status: 'retired' },
    },
  }, 'Child');

  assert.deepStrictEqual(replaced.allows_relations.relation_ids, []);
  assert.strictEqual(replaced.allows_relations.source_class, 'Child');
  assert.deepStrictEqual(replaced.allows_relations.override_chain, [
    { class_id: 'Root', relation_ids: ['OLD'] },
    { class_id: 'Child', relation_ids: [] },
  ]);
});

test('多父、未知父、自指和循环均拒绝', async (t) => {
  await t.test('多父', () => {
    expectError('MULTIPLE_PARENTS', () => resolveClassInheritance({
      node_types: {
        RootA: {},
        RootB: {},
        Child: { subClassOf: ['RootA', 'RootB'] },
      },
    }, 'Child'));
  });

  await t.test('未知父', () => {
    expectError('UNKNOWN_PARENT_CLASS', () => resolveClassInheritance({
      node_types: { Child: { subClassOf: 'Missing' } },
    }, 'Child'));
  });

  await t.test('自指', () => {
    expectError('SELF_INHERITANCE', () => resolveClassInheritance({
      node_types: { Child: { subClassOf: 'Child' } },
    }, 'Child'));
  });

  await t.test('循环', () => {
    expectError('INHERITANCE_CYCLE', () => resolveClassInheritance({
      node_types: {
        A: { subClassOf: 'B' },
        B: { subClassOf: 'C' },
        C: { subClassOf: 'A' },
      },
    }, 'A'));
  });
});

test('现役类的父链在四态非现役父类处均拒绝', () => {
  for (const status of ['draft', 'submitted', 'reserved', 'retired']) {
    expectError('NON_APPROVED_CLASS_IN_CHAIN', () => resolveClassInheritance({
      node_types: {
        Parent: { lifecycle_status: status },
        Child: { subClassOf: 'Parent' },
      },
    }, 'Child'));
  }
});

test('全量活解析排除非现役类，单类解析非现役目标显式拒绝', () => {
  const ontology = {
    node_types: {
      Active: {},
      Draft: { lifecycle_status: 'draft' },
      Submitted: { lifecycle_status: 'submitted' },
      Reserved: { lifecycle_status: 'reserved' },
      Retired: { lifecycle_status: 'retired' },
    },
  };

  assert.deepStrictEqual(Object.keys(resolveOntologyInheritance(ontology)), ['Active']);
  expectError('NON_APPROVED_CLASS_IN_CHAIN', () => {
    resolveClassInheritance(ontology, 'Draft');
  });
});

test('合成后的未知关系和四态非现役关系均拒绝', () => {
  expectError('UNKNOWN_RELATION', () => resolveClassInheritance({
    node_types: { Root: { allows_relations: ['MISSING'] } },
    relation_types: {},
  }, 'Root'));

  for (const status of ['draft', 'submitted', 'reserved', 'retired']) {
    expectError('NON_APPROVED_RELATION', () => resolveClassInheritance({
      node_types: { Root: { allows_relations: ['R'] } },
      relation_types: { R: { lifecycle_status: status } },
    }, 'Root'));
  }
});

test('同名绑定不得携带字段类型、元素类别或引用目标类型改型', () => {
  for (const [key, value] of [
    ['type', 'date'],
    ['class', 'OtherClass'],
    ['target_type', 'OtherTarget'],
  ]) {
    expectError('ILLEGAL_DATA_PROPERTY_REDEFINITION', () => resolveClassInheritance({
      node_types: {
        Root: { data_properties: { title: { required: true } } },
        Child: {
          subClassOf: 'Root',
          data_properties: { title: { [key]: value } },
        },
      },
    }, 'Child', { fields: [{ name: 'title', type: 'string' }] }));
  }

  expectError('UNKNOWN_DATA_PROPERTY', () => resolveClassInheritance({
    node_types: { Root: { data_properties: { missing: { required: true } } } },
  }, 'Root', { fields: [{ name: 'title', type: 'string' }] }));

  expectError('FIELD_DEFINITIONS_REQUIRED', () => resolveClassInheritance({
    node_types: { Root: { data_properties: { title: { required: true } } } },
  }, 'Root'));
});

test('风险注册表完全不参与 Wave 0 解析', () => {
  const ontology = { node_types: { Root: {} } };
  Object.defineProperty(ontology, 'risk_types', {
    enumerable: true,
    get() {
      throw new Error('risk_types must not be read');
    },
  });

  const result = resolveClassInheritance(ontology, 'Root');
  assert.strictEqual(hasOwn(result, 'risk_types'), false);
});

test('解析不修改输入，重复调用输出一致，修改输出也不会回写输入', () => {
  const ontology = deepFreeze(richOntology());
  const fields = deepFreeze(richFields());
  const snapshot = JSON.stringify(ontology);

  const first = resolveClassInheritance(ontology, 'Leaf', fields);
  const second = resolveClassInheritance(ontology, 'Leaf', fields);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(JSON.stringify(ontology), snapshot);

  first.data_properties.title.binding.permission = 'changed';
  first.inheritance_chain.reverse();
  assert.strictEqual(ontology.node_types.Leaf.data_properties.title.permission, 'private');
  assert.deepStrictEqual(ontology.node_types.Leaf, richOntology().node_types.Leaf);
});

test('退役读侧归一沿 A→B→C 多跳，保留原始 ID 和完整链且不压平输入', () => {
  const registry = deepFreeze({
    A: {
      lifecycle_status: 'retired',
      retirement: { reason: 'replaced', replaced_by: 'B' },
    },
    B: {
      lifecycle_status: 'retired',
      retirement: { reason: 'replaced again', replaced_by: 'C' },
    },
    C: {},
  });
  const snapshot = JSON.stringify(registry);

  const expected = {
    original_id: 'A',
    resolved_id: 'C',
    replacement_chain: ['A', 'B', 'C'],
  };
  assert.deepStrictEqual(normalizeRetiredReference(registry, 'A'), expected);
  assert.deepStrictEqual(normalizeRetiredReference(registry, 'A'), expected);
  assert.deepStrictEqual(normalizeRetiredReference(registry, 'B'), {
    original_id: 'B',
    resolved_id: 'C',
    replacement_chain: ['B', 'C'],
  });
  assert.deepStrictEqual(normalizeRetiredReference(registry, 'C'), {
    original_id: 'C',
    resolved_id: 'C',
    replacement_chain: ['C'],
  });
  assert.strictEqual(JSON.stringify(registry), snapshot);
  assert.strictEqual(registry.A.retirement.replaced_by, 'B');
});

test('反向对账从直接指针派生直接与传递视图，不回写第二根指针', () => {
  const registry = deepFreeze({
    A: { lifecycle_status: 'retired', retirement: { reason: 'a', replaced_by: 'B' } },
    B: { lifecycle_status: 'retired', retirement: { reason: 'b', replaced_by: 'C' } },
    C: {},
  });

  assert.deepStrictEqual(reconcileRetirementReferences(registry), {
    elements: {
      A: {
        replaced_by: 'B', resolved_id: 'C', replacement_chain: ['A', 'B', 'C'],
        direct_replacers: [], transitive_replacers: [],
      },
      B: {
        replaced_by: 'C', resolved_id: 'C', replacement_chain: ['B', 'C'],
        direct_replacers: ['A'], transitive_replacers: ['A'],
      },
      C: {
        replaced_by: null, resolved_id: 'C', replacement_chain: ['C'],
        direct_replacers: ['B'], transitive_replacers: ['A', 'B'],
      },
    },
  });
  assert.strictEqual(hasOwn(registry.C, 'direct_replacers'), false);
  expectError('DANGLING_REPLACEMENT', () => reconcileRetirementReferences({
    A: { lifecycle_status: 'retired', retirement: { reason: 'a', replaced_by: 'Missing' } },
  }));
});

test('反向对账保留无关非现役元素但不为它们伪造替代链', () => {
  const result = reconcileRetirementReferences({
    A: { lifecycle_status: 'retired', retirement: { reason: 'a', replaced_by: 'B' } },
    B: {},
    Draft: { lifecycle_status: 'draft' },
    Submitted: { lifecycle_status: 'submitted' },
    Reserved: { lifecycle_status: 'reserved' },
  });

  assert.strictEqual(result.elements.A.resolved_id, 'B');
  assert.deepStrictEqual(result.elements.B.direct_replacers, ['A']);
  for (const id of ['Draft', 'Submitted', 'Reserved']) {
    assert.deepStrictEqual(result.elements[id], {
      replaced_by: null,
      resolved_id: null,
      replacement_chain: [],
      direct_replacers: [],
      transitive_replacers: [],
    });
  }
  expectError('NO_APPROVED_REPLACEMENT', () => reconcileRetirementReferences({
    A: { lifecycle_status: 'retired', retirement: { reason: 'a', replaced_by: 'Draft' } },
    Draft: { lifecycle_status: 'draft' },
  }));
});

test('反向对账只认注册表自身键：原型同名 ID 不读原型、不写原型', () => {
  // 用 JSON.parse 造出与 YAML/JSON 落盘同形的自有 __proto__ 键（对象字面量写法会改原型而非建属性）
  const registry = JSON.parse('{"A":{"lifecycle_status":"retired","retirement":{"reason":"a","replaced_by":"__proto__"}},'
    + '"__proto__":{"lifecycle_status":"retired","retirement":{"reason":"p","replaced_by":"constructor"}},"constructor":{}}');
  assert.strictEqual(hasOwn(registry, '__proto__'), true, '夹具必须是自有键');
  const result = reconcileRetirementReferences(registry);

  assert.deepStrictEqual(Object.keys(result.elements).sort(), ['A', '__proto__', 'constructor']);
  assert.strictEqual(hasOwn(result.elements, '__proto__'), true, '原型同名 ID 是自身数据属性');
  assert.strictEqual(result.elements.A.resolved_id, 'constructor');
  assert.deepStrictEqual(result.elements.A.replacement_chain, ['A', '__proto__', 'constructor']);
  assert.deepStrictEqual(result.elements.constructor.direct_replacers, ['__proto__']);
  assert.deepStrictEqual(result.elements.constructor.transitive_replacers, ['A', '__proto__']);
  assert.strictEqual(Object.getPrototypeOf(result.elements), Object.prototype);
  assert.strictEqual({}.direct_replacers, undefined, '普通对象原型未被污染');
  expectError('DANGLING_REPLACEMENT', () => reconcileRetirementReferences({
    A: { lifecycle_status: 'retired', retirement: { reason: 'a', replaced_by: 'toString' } },
  }));
});

test('退役归一拒绝跨类型、悬空、循环、自指和无现役终点', async (t) => {
  await t.test('跨类型', () => {
    const registry = {
      A: { lifecycle_status: 'retired', retirement: { replaced_by: 'R' } },
    };
    expectError('CROSS_TYPE_REPLACEMENT', () => normalizeRetiredReference(registry, 'A', {
      elementType: 'node_types',
      registries: {
        node_types: registry,
        relation_types: { R: {} },
      },
    }));
  });

  await t.test('悬空', () => {
    expectError('DANGLING_REPLACEMENT', () => normalizeRetiredReference({
      A: { lifecycle_status: 'retired', retirement: { replaced_by: 'Missing' } },
    }, 'A'));
  });

  await t.test('循环', () => {
    expectError('REPLACEMENT_CYCLE', () => normalizeRetiredReference({
      A: { lifecycle_status: 'retired', retirement: { replaced_by: 'B' } },
      B: { lifecycle_status: 'retired', retirement: { replaced_by: 'A' } },
    }, 'A'));
  });

  await t.test('自指', () => {
    expectError('REPLACEMENT_SELF_REFERENCE', () => normalizeRetiredReference({
      A: { lifecycle_status: 'retired', retirement: { replaced_by: 'A' } },
    }, 'A'));
  });

  await t.test('无现役终点', () => {
    for (const status of ['draft', 'submitted', 'reserved']) {
      expectError('NO_APPROVED_REPLACEMENT', () => normalizeRetiredReference({
        A: { lifecycle_status: 'retired', retirement: { replaced_by: 'B' } },
        B: { lifecycle_status: status },
      }, 'A'));
    }
  });

  await t.test('退役但无替代目标', () => {
    expectError('MISSING_REPLACEMENT', () => normalizeRetiredReference({
      A: { lifecycle_status: 'retired', retirement: { reason: 'obsolete' } },
    }, 'A'));
  });

  await t.test('原始 ID 不存在', () => {
    expectError('UNKNOWN_ELEMENT', () => normalizeRetiredReference({}, 'Missing'));
  });
});

test('每条失败路径保留原始 ID 与完整替代链，不改源定义', () => {
  const retired = (id) => ({ lifecycle_status: 'retired', retirement: { replaced_by: id } });
  const cases = [
    ['UNKNOWN_ELEMENT', {}, ['A']],
    ['DANGLING_REPLACEMENT', { A: retired('B') }, ['A', 'B']],
    ['INVALID_ELEMENT_DEFINITION', { A: retired('B'), B: null }, ['A', 'B']],
    ['INVALID_LIFECYCLE_STATUS', { A: retired('B'), B: { lifecycle_status: false } }, ['A', 'B']],
    ['MISSING_REPLACEMENT', { A: retired('B'), B: { lifecycle_status: 'retired' } }, ['A', 'B']],
    ['REPLACEMENT_SELF_REFERENCE', { A: retired('B'), B: retired('B') }, ['A', 'B', 'B']],
    ['REPLACEMENT_CYCLE', { A: retired('B'), B: retired('A') }, ['A', 'B', 'A']],
    ['NO_APPROVED_REPLACEMENT', { A: retired('B'), B: { lifecycle_status: 'draft' } }, ['A', 'B']],
    ['CROSS_TYPE_REPLACEMENT', { A: retired('B') }, ['A', 'B'], { elementType: 'node_types', registries: { relation_types: { B: {} } } }],
  ];
  for (const [code, registry, chain, options] of cases) {
    const before = structuredClone(registry);
    assert.throws(() => normalizeRetiredReference(registry, 'A', options), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.details.original_id, 'A');
      assert.deepEqual(error.details.replacement_chain, chain);
      return true;
    });
    assert.deepEqual(registry, before);
  }
});
