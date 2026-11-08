// Theschema-Root 的 ESM 面（quality 脚本用——实现单源于 server/shared cjs，此处仅桥接）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const { resolveTheSchemaDir, REPO_THESCHEMA } = require("../../../server/shared/theschema-root.cjs");
