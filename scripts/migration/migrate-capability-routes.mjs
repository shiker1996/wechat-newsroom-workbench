import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLegacyCapabilityRoutes } from '../../server/platform/tools/capability-routes.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');console.log(JSON.stringify(migrateLegacyCapabilityRoutes(root),null,2));
