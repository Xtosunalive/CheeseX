# Pull Request

## 改动说明

<!-- 一句话说清这个 PR 解决什么问题、怎么改的 -->

## 关联 Issue

<!-- 例如：Closes #123；没有对应 issue 可写"无" -->

## 验证

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test` 通过
- [ ] 涉及关键链路时已跑 `npm run test:e2e`
- [ ] 文档随行为同步更新（如适用）

## 检查清单

- [ ] 未提交 `.env`、个人机器路径或任何密钥/令牌
- [ ] HTTP API 改动已先改 `contracts/http-api.openapi.json` 并重生成类型
- [ ] 未手改 `src/lib/generated/` 等生成产物
- [ ] 新增行为已补对应测试
