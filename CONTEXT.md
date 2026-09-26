# Tesla Wrap Preview

Previews Tesla Paint Shop custom wraps on the in-car 3D vehicle model, for people (web page) and for wrap-generating AI agents (CLI).

## Language

**Wrap**:
The PNG a user loads into Tesla Paint Shop; its pixels are sampled onto the car body through the model's wrap UVs.
_Avoid_: skin, livery, texture, 车衣图

**Template**:
Tesla's official `template.png` for one vehicle in `teslamotors/custom-wraps`: panel outlines in wrap-PNG space.
_Avoid_: UV map, stencil

**Vehicle**:
One entry of `teslamotors/custom-wraps` with its own template and 3D model (e.g. `modely` = Model Y 2020–2024).
_Avoid_: car model, trim

**In-car model**:
The 3D model Tesla's UI renders, whose second UV set (`TEXCOORD_1`) defines where each wrap pixel lands.
_Avoid_: mesh, asset

**Panel**:
One body part that receives wrap pixels, named from the driver's seat (e.g. `door_front_left`, `hood`).
_Avoid_: island, part, region

**Panel map**:
Per-pixel lookup from wrap-PNG space to panel, derived from the in-car model's wrap UVs.
_Avoid_: mask, label image

**Panel orientation**:
Which car direction the wrap PNG's right and up axes point to on a panel, and whether artwork appears mirrored from outside.

**Coverage**:
Share of a panel's pixels that are fully opaque in a wrap.

**Base paint**:
The colour shown where a wrap is transparent.
_Avoid_: background, body colour

**Finish**:
Surface look of the wrap: gloss, satin or matte.

**Version**:
One wrap loaded for side-by-side comparison in the web page (up to four, sharing one camera).
_Avoid_: variant, iteration

**View**:
A named camera preset (`front_left`, `left`, `top`, …) used for renders.

**Contact sheet**:
One image combining all rendered views of a wrap, labelled by view name.
_Avoid_: grid, montage
