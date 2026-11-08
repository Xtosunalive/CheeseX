'use strict';
// Component: Vocab-Load-Port（词表装载入口——ADR-016 §六 第一切片／SPEC-044 C1-C2）
// @responsible: 五件词表（data/theschema 的 enums/fields/versions/ontology/dependencies.yaml
//   及运行时 vault 侧同名件）的唯一装载宿主（ADR-016 §四-2 裁决「装载收进同一宿主」，
//   Master 2026-10-31）：fs 读取与 YAML.parse 只允许发生在本模块；Python 侧零词表读取路径，
//   消费 Node 侧经版本化信封递入的类型化载荷。
//   组合既有单点：路径解析复用 theschema-root.cjs（唯一解析点），形态收口复用
//   theschema-loader.cjs（纯函数引擎）——本模块不重造路径阶梯与校验管线。
// @inputs: vaultPath（或经 THESCHEMA_DIR 注入的目录）
// @outputs: loadVocabBundle（类型化领域对象＋三态可分＋来源指纹＋读放大统计）；
//   serializeVocabEnvelope（Node→Python 版本化信封）；vocabLookup（三态查询）
// @context: Vault（Sync）
//
// 纪律（SPEC-044）：
//   · 三态可分（C6）：缺键／空串／空数组在领域对象上是三种不同形态，vocabLookup 逐一区分；
//   · 无隐式回落（C2）：坏内容 fail-closed 显式失败，不静默降级为自己再读或空表；
//   · 读放大预算（ADR-016 §六-1 判据5）：本模块是读放大的集中点，读取次数/耗时可观测，
//     超预算显式告警——预算缺省值为临时观测值（L4 收敛验收批按实测校准），可经
//     VOCAB_READ_BUDGET 覆盖，不作为硬机制拦截，只作显式告警。
//   · ADR-015：指纹是收据不是权威；装载产物为现场计算结果，不落第二权威存储。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const { resolveTheSchemaDir } = require('./theschema-root.cjs');
const { normalizeDocument } = require('./theschema-loader.cjs');

const VOCAB_FILE_NAMES = Object.freeze(['enums', 'fields', 'versions', 'ontology', 'dependencies']);
// WP-054 E-A（SPEC-049 X1/X2）：扩展文档件——信封 files 面开放新增（registry 在册、形态收口同引擎）；
// 文件名映射（entity_aliases → entity-aliases.yaml，registry 键名与文件名不同者在此登记）。
const EXTENSION_DOC_NAMES = Object.freeze(['article_associations', 'entity-aliases']);
const ENVELOPE_VERSION = 1;

function allDocNames() {
  return [...VOCAB_FILE_NAMES, ...EXTENSION_DOC_NAMES];
}

// 读放大预算（缺省 5000 次/进程）：WP-049 L4 实测校准值——单次 loadVocabBundle＝5 读、
// 单读 ~0.2ms；合法高频面＝freshness 轮询（仪表盘 5s 间隔 ×1h＝720 次＝3600 读），
// 5000 覆盖整小时合法轮询仍低于病态面（热循环内误装载很快破万）；每进程告警一次不拦截。
// VOCAB_READ_BUDGET 可覆盖；再校准以 getVocabReadStats() 实测为准。
function readBudget() {
  const raw = Number(process.env.VOCAB_READ_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
}

const readStats = { fileReads: 0, totalMs: 0, budgetWarnings: 0 };

function noteRead(ms, warn) {
  readStats.fileReads += 1;
  readStats.totalMs += ms;
  if (readStats.fileReads > readBudget() && readStats.budgetWarnings < 1) {
    readStats.budgetWarnings += 1;
    const line = `vocab-read-budget-exceeded: 进程内词表读取 ${readStats.fileReads} 次已超预算 ${readBudget()}（VOCAB_READ_BUDGET 可调）——读放大集中在装载入口，请核对消费方是否应共享一次装载`;
    (warn || console.error)(line);
  }
}

function getVocabReadStats() {
  return { ...readStats, budget: readBudget() };
}

/**
 * 原型安全深变换（WP-050 D1／SPEC-045）：装载产物的全部映射一律 null 原型——
 * 内容可写字符串作键的原型命中（constructor/toString/__proto__ 族）从结构上不可表达
 * （`obj["constructor"]` 返回 undefined 而非 Function）。数组保序、标量透传、
 * 嵌套对象递归；JSON.stringify／Object.keys／Object.hasOwn／展开均不受影响。
 */
function nullProtoDeep(value) {
  if (Array.isArray(value)) return value.map(nullProtoDeep);
  if (value && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value)) out[key] = nullProtoDeep(value[key]);
    return out;
  }
  return value;
}

/** 读放大统计只测磁盘读取本身；YAML 解析与形态收口不计入（它们不放大 I/O）。 */
function readVocabFile(dir, name, warn) {
  const filePath = path.join(dir, `${name}.yaml`);
  const started = process.hrtime.bigint();
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  noteRead(Number(process.hrtime.bigint() - started) / 1e6, warn);
  const fingerprint = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  let parsed;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    // fail-closed：词表在仓内治理，坏内容显式失败，不静默给空对象（SPEC-044 C2 无隐式回落）。
    // 保留原始 error.code（yaml 包的 BAD_INDENT 族）——上游路由按 code 派发响应码，重包装不得吞码。
    const wrapped = new Error(`VOCAB_PARSE_FAILED: ${filePath} YAML 解析失败——${error.message}`);
    if (error && error.code) wrapped.code = error.code;
    wrapped.cause = error;
    throw wrapped;
  }
  // raw＝形态收口前的解析结果（可为 null——空文件的原生形态），门禁类消费方审计原始内容用：
  // 校验/审计若吃 normalized 数据，脏节点已被局部降级丢弃 → 会把「本来该红」审成绿（假绿方向）。
  // WP-050 D1：raw/data 同为装载产物，一律 null 原型深变换（审计内容不变，原型面不可表达）。
  const raw = parsed === null || parsed === undefined ? null : nullProtoDeep(parsed);
  const document = parsed === null || parsed === undefined ? {} : parsed;
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`VOCAB_SHAPE_FAILED: ${filePath} 顶层必须是映射，实得 ${Array.isArray(parsed) ? '数组' : typeof parsed}`);
  }
  // 形态收口走既有引擎（宽容→严格→局部降级，语义与 PR-053 完全一致，不因入口上线改变）
  const { data, normalizationTrail, degradedNodes } = normalizeDocument(name, document, { warn });
  return { state: 'present', fingerprint, text, raw, data: nullProtoDeep(data), normalizationTrail, degradedNodes };
}

function selectedFileNames(files) {
  if (files === undefined || files === null) return VOCAB_FILE_NAMES;
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError('VOCAB_FILES_INVALID: options.files 必须是五件＋扩展件名的非空子集数组');
  }
  const known = allDocNames();
  for (const name of files) {
    if (!known.includes(name)) {
      throw new TypeError(`VOCAB_FILES_INVALID: '${name}' 不在装载件集内（五件：${VOCAB_FILE_NAMES.join('/')}；扩展：${EXTENSION_DOC_NAMES.join('/')}）`);
    }
  }
  return [...new Set(files)];
}

/**
 * 装载词表为类型化领域对象束（阶梯解析：THESCHEMA_DIR 注入＞vault 侧＞仓内主源）。
 * @param {string|null} vaultPath vault 根（theschema-root 阶梯用）
 * @param {object} [options] { warn } 降级/预算告警回调；{ files } 五件子集（缺省全五件）——
 *   只需一两件的消费方按需选取，读放大不因入口唯一化而增加（单件仍只读一次）
 * @returns 束：files 逐件 { state: 'present'|'missing', fingerprint, text, raw, data }；
 *   missing 是显式状态不是静默空表——消费方必须按 state 分支，不得把 missing 当空对象用。
 */
function loadVocabBundle(vaultPath, options) {
  return loadFromDir(resolveTheSchemaDir(vaultPath), options);
}

/** 显式目录装载：仓内主源锚定/夹具目录等已知目录的消费方（不走阶梯——调用方对目录负责）。 */
function loadVocabFromDir(dir, options) {
  if (typeof dir !== 'string' || !dir) {
    throw new TypeError('loadVocabFromDir: dir 必须是非空目录路径');
  }
  return loadFromDir(dir, options);
}

function loadFromDir(dir, options) {
  const warn = (options && options.warn) || console.error;
  const names = selectedFileNames(options && options.files);
  const files = {};
  for (const name of names) {
    files[name] = readVocabFile(dir, name, warn);
  }
  return {
    dir,
    envelopeVersion: ENVELOPE_VERSION,
    generatedAt: new Date().toISOString(),
    files,
    stats: getVocabReadStats(),
  };
}

/**
 * 三态查询（SPEC-044 C6）：区分「映射不存在／键不存在／空串／空数组／有值」五种形态。
 * P3 病根（{旧层:""} 与 {旧层:[]} 与缺键混同）在此处显形——消费方按 state 各自确定行为。
 */
function vocabLookup(bundle, fileName, mapKey, key) {
  const file = bundle && bundle.files && bundle.files[fileName];
  if (!file) throw new TypeError(`vocabLookup: 未知词表件 '${fileName}'（合法：${VOCAB_FILE_NAMES.join('/')}`);
  if (file.state === 'missing') return { state: 'file-missing', value: undefined };
  const map = file.data && file.data[mapKey];
  if (map === undefined || map === null) return { state: 'map-absent', value: undefined };
  if (typeof map !== 'object' || Array.isArray(map)) {
    throw new TypeError(`vocabLookup: ${fileName}.${mapKey} 不是映射（实得 ${Array.isArray(map) ? '数组' : typeof map}）——三态查询只对映射面定义`);
  }
  if (!Object.prototype.hasOwnProperty.call(map, key)) return { state: 'key-absent', value: undefined };
  const value = map[key];
  if (value === '') return { state: 'empty-string', value };
  if (Array.isArray(value) && value.length === 0) return { state: 'empty-collection', value };
  return { state: 'present', value };
}

/**
 * Node→Python 版本化信封（SPEC-044 C2）：载荷＝{ envelope_version, source_fingerprint,
 * generated_at, files:{name→data} }。三态在序列化下可分（"" 保空串、[] 保空数组、缺键保持缺键）；
 * fingerprint 是来源收据（ADR-015：收据不是权威），接收方校验信封版本后消费，不得回落自读。
 */
function serializeVocabEnvelope(bundle) {
  if (!bundle || bundle.envelopeVersion !== ENVELOPE_VERSION) {
    throw new TypeError(`serializeVocabEnvelope: 信封版本不匹配（期望 ${ENVELOPE_VERSION}）`);
  }
  const files = {};
  const source_fingerprint = {};
  const degraded = {};
  // WP-054 E-A：按束内实装载件序列化（五件＋扩展件——子集装载面自然生效）
  for (const name of Object.keys(bundle.files)) {
    const file = bundle.files[name];
    if (file && file.state === 'present') {
      files[name] = file.data;
      source_fingerprint[name] = file.fingerprint;
      if (file.degradedNodes && file.degradedNodes.length) {
        degraded[name] = file.degradedNodes.map((node) => ({ path: node.path, pathParts: node.pathParts }));
      }
    }
  }
  return {
    envelope_version: ENVELOPE_VERSION,
    source_fingerprint,
    generated_at: bundle.generatedAt,
    files,
    degraded,
  };
}

/** 信封接收侧校验（Node 对拍/测试用；Python 接收器 L3 随读面归零批落地）。fail-closed。 */
function parseVocabEnvelope(payload) {
  let envelope;
  try {
    envelope = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (error) {
    throw new Error(`VOCAB_ENVELOPE_UNREADABLE: ${error.message}`);
  }
  if (!envelope || typeof envelope !== 'object') throw new Error('VOCAB_ENVELOPE_UNREADABLE: 信封必须是对象');
  if (envelope.envelope_version !== ENVELOPE_VERSION) {
    throw new Error(`VOCAB_ENVELOPE_VERSION_MISMATCH: 期望 ${ENVELOPE_VERSION}，实得 ${String(envelope.envelope_version)}——拒绝消费，不得回落自读`);
  }
  if (!envelope.source_fingerprint || typeof envelope.source_fingerprint !== 'object') {
    throw new Error('VOCAB_ENVELOPE_UNREADABLE: source_fingerprint 缺失');
  }
  for (const name of VOCAB_FILE_NAMES) {
    if (envelope.source_fingerprint[name] !== undefined && !/^[0-9a-f]{64}$/.test(envelope.source_fingerprint[name])) {
      throw new Error(`VOCAB_ENVELOPE_UNREADABLE: ${name} 指纹不是 sha256 十六进制`);
    }
  }
  return envelope;
}

/**
 * 单件便捷取数（raw 视图）：present→形态收口前的解析原文（消费方自决归一——与旧
 * 「YAML.parse(readFileSync()) || {}」等形）；missing→fallback。含点：每次调用＝1 读
 * （读放大经 stats 可观测）。需收口后数据/指纹/文本者用 loadVocabBundle 取全记录。
 */
function readVocabDoc(vaultPath, name, fallback = {}) {
  const file = loadFromDir(resolveTheSchemaDir(vaultPath), { files: [name] }).files[name];
  return file && file.state === 'present' && file.raw !== null && file.raw !== undefined ? file.raw : fallback;
}

module.exports = {
  VOCAB_FILE_NAMES,
  EXTENSION_DOC_NAMES,
  allDocNames,
  ENVELOPE_VERSION,
  loadVocabBundle,
  loadVocabFromDir,
  readVocabDoc,
  vocabLookup,
  serializeVocabEnvelope,
  parseVocabEnvelope,
  getVocabReadStats,
};
