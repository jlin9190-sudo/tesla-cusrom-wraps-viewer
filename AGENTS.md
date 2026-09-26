## 仓库

把 Tesla Paint Shop 的 wrap PNG 贴到 in-car model 上预览。

- **网页**：给人用。拖入 PNG 做 3D 预览，最多四个 version，共用一个相机。
- **CLI `wrap-preview`**：给生成 wrap 的 agent 用。输出多视角渲染、contact sheet 和 JSON 报告，按贴到车上的效果迭代。

目前只有 Model Y（2020–2024，template 目录 `modely`）。贴图位置由 in-car model 的第二套 UV（`TEXCOORD_1`）决定，与官方 `template.png` 对齐。

术语见 `CONTEXT.md`。产品、CLI 和目录见 `README.md`。决策见 `docs/adr/`。

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
