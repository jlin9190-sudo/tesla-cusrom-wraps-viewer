/** Downloads Tesla's templates and example wraps for every supported vehicle into public/custom-wraps. */
import { ensureCustomWraps } from '../cli/assets.ts';
import { VEHICLES } from '../src/core/vehicles.ts';

for (const vehicle of Object.values(VEHICLES)) {
  const manifest = await ensureCustomWraps(vehicle, true);
  console.log(`${vehicle.id}: template + ${manifest.examples.length} examples`);
}
