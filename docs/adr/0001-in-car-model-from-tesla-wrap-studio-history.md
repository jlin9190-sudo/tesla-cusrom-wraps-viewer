# Use the in-car Model Y model recovered from Tesla-Wrap-Studio's history, committed as a GLB

Tesla publishes wrap templates but no 3D models, and a generic Model Y model would not share the template's UV layout. The only model whose second UV set matches `modely/template.png` pixel-for-pixel is the Godot export of the in-car model that `dtschannen/Tesla-Wrap-Studio` committed in `4063aee` and later removed from `HEAD`. We rebuild our GLB from that commit (sha256-pinned in `scripts/build-vehicle.ts`) and commit the output, because the upstream copy already disappeared once and could vanish entirely. Copyright was explicitly waived as a concern by the project owner.

## Considered Options

- **Approximate model with per-panel projection**: works for every vehicle but misplaces seams and orientation, which would mislead agents iterating on the render.
- **Bring-your-own GLB, ship nothing**: no licensing question, but the tool would not work out of the box.
- **Download from the pinned upstream commit at install time**: smaller repo, but breaks if the upstream history is rewritten or deleted.

## Consequences

Only `modely` is supported. The source ships 4×4 placeholder textures, so every material is re-created by role in `src/core/vehicles.ts`; wheels are procedural because the model only contains wheel anchor nodes.
