'use strict';
// WP-049 余量批（SPEC-044 C4，P6 状态族对账钉）：状态四值三面对账——
// TheSchema lifecycle.status（词表声明面，经装载端口）≡ contracts/entity-readiness-rules.json
// statusMachine.values（状态机语义宿主）≡ legacy_status_map 映射目标⊆四值。
// 旧值→四值映射单源＝TheSchema lifecycle.legacy_status_map（status-domain.cjs 取数）。
// 层级：纯单元（真库数据面——THESCHEMA_DIR 钉扎基线夹具防活态渗入）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { statusFourValues, legacyStatusMap, normalizeStatus } = require('../../../shared/status-domain.cjs');
const { STATUS_MACHINE } = require('../../../shared/status-transition-guard.cjs');
const contract = require('../../../../contracts/entity-readiness-rules.json');

function makePinnedVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-ssot-'));
  const ts = path.join(dir, '知识库', 'TheSchema');
  fs.mkdirSync(ts, { recursive: true });
  const prev = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = ts;
  return { dir, ts, restore: () => { if (prev === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = prev; } };
}

test('三面对账：TheSchema 词表 ≡ 契约状态机 ≡ 挂起映射目标', () => {
  const pinned = makePinnedVault();
  try {
    fs.writeFileSync(path.join(pinned.ts, 'enums.yaml'), [
      'lifecycle:',
      '  status:',
      '    - 灰度',
      '    - 在线',
      '    - 退役',
      '    - 已驳回',
      '  default_status: 灰度',
      '  legacy_status_map:',
      '    制定中: 灰度',
      '    有效: 在线',
      '    已归档: 退役',
      '',
    ].join('\n'), 'utf8');
    const declared = statusFourValues(pinned.dir);
    assert.deepEqual([...declared].sort(), [...STATUS_MACHINE.values].sort(), 'TheSchema 词表 ≡ 状态机值集');
    assert.deepEqual([...declared].sort(), [...contract.statusMachine.values].sort(), 'TheSchema 词表 ≡ 契约');
    for (const target of Object.values(legacyStatusMap(pinned.dir))) {
      assert.ok(declared.includes(target), `映射目标 ${target} 必须在四值内`);
    }
    assert.equal(normalizeStatus('制定中', pinned.dir), '灰度');
    assert.equal(normalizeStatus('在线', pinned.dir), '在线', '新值透传');
    assert.equal(normalizeStatus(undefined, pinned.dir), '', '非串透传');
  } finally {
    pinned.restore();
  }
});
