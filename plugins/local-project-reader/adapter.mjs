import { readLocalProjectImplementation } from '../../lib/integrations/local-project-reader-core.mjs';
import { ok } from '../../lib/tools/schemas.mjs';

export async function execute(input) {
  return ok(readLocalProjectImplementation(input.path, input.options), { provenance:{ root:input.path } });
}

export async function health() {
  return ok({ available:true });
}
