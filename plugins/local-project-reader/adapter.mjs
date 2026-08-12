import { readLocalProjectImplementation } from './implementation.mjs';
import { ok } from '../shared/schemas.mjs';

export async function execute(input) {
  return ok(readLocalProjectImplementation(input.path, input.options), { provenance:{ root:input.path } });
}

export async function health() {
  return ok({ available:true });
}
