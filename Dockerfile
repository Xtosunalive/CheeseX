# cheeseh — 知识库驱动的架构图谱工作台
# 多阶段构建：base（全量构建）→ production（只含运行时必需品，无治理/内部文件）

# ── base 阶段：依赖安装＋前端构建 ──
FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages pyyaml

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── production 阶段：只拷运行时必需品（源码中的 server/shared/data/scripts-vault）──
FROM node:22-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages pyyaml

WORKDIR /app

# node_modules 从 base 阶段拷（含生产依赖，devDependencies 被 npm prune 排除）
COPY --from=base /app/node_modules ./node_modules
# 前端构建产物
COPY --from=base /app/dist ./dist
# 后端运行时
COPY --from=base /app/server ./server
COPY --from=base /app/shared ./shared
# TheSchema 主源（产品数据）
COPY --from=base /app/data ./data
# package.json（启动入口需要）
COPY --from=base /app/package.json ./package.json
# vault 运行时脚本（管线依赖）
COPY --from=base /app/scripts/vault-runtime ./scripts/vault-runtime

ENV NODE_ENV=production
ENV API_PORT=18083
ENV API_HOST=0.0.0.0

VOLUME ["/vault"]
EXPOSE 18083

CMD ["node", "server/main.cjs"]
