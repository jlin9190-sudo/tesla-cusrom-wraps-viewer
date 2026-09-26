# Tesla 车衣 3D 预览器

把 Tesla Paint Shop 的车衣 PNG 贴到**车机原版 3D 车模**上预览，用法和官方 [teslamotors/custom-wraps](https://github.com/teslamotors/custom-wraps) 一致。

- **网页**：拖入 PNG 即可 3D 预览，最多 4 个版本并排对比（共享同一相机）。
- **CLI `wrap-preview`**：给 AI agent 用。输出多视角渲染图、contact sheet 和 JSON 报告，让生成车衣的 agent 根据实际渲染效果自行迭代。

目前支持 **Model Y（2020–2024，模板目录 `modely`）**。车模的第二套 UV（`TEXCOORD_1`）与官方 `modely/template.png` 逐像素对齐，来源见 [ADR 0001](docs/adr/0001-in-car-model-from-tesla-wrap-studio-history.md)。

## 快速开始

需要 Node.js 22 及以上。

```bash
npm install
npx playwright install chromium   # CLI 渲染用的无头浏览器（Linux 首次可加 --with-deps）
npm run fetch-assets              # 可选：下载 Tesla 官方模板和 20 个示例到 public/custom-wraps/
npm run dev                       # 打开 http://localhost:5173
```

### 网页功能

- 拖入或选择 PNG（也可以从下拉框加载 Tesla 官方示例）。最多同时 4 个版本，自动排成 1×1、1×2 或 2×2 分屏，相机同步。
- 每个版本都有合规检查（尺寸、文件大小、文件名规则），以及按面板统计的覆盖率和平均色。
- 亮面、缎面、哑光三种质感；可设置底漆颜色（透明像素处显示）。
- "显示面板轮廓与名称"开关：把面板边界和英文面板名直接画到车身上，方便对位。
- 7 个预设视角，支持截图下载。

## 给 AI agent：`wrap-preview` CLI

```bash
npx wrap-preview --help            # 或 node bin/wrap-preview.mjs --help
```

| 命令 | 作用 |
|------|------|
| `template --out <dir>` | 输出官方 `template.png`、面板标签图 `panels.png`（R 通道为面板序号）、带面板名的引导图 `panels-guide.png` 和 `panels.json`。**设计之前先跑一次。** |
| `check <wrap.png>` | 不渲染，只检查 Tesla 规则和各面板覆盖率。速度快，适合每改一版先跑一次。 |
| `render <wrap.png> --out <dir>` | 渲染到车上，输出 `views/<view>.png`、`sheet.png`（全部视角的 contact sheet）和 `report.json`。 |

`render` 的选项：`--views front_left,left,...`、`--size 1024x640`、`--finish gloss|satin|matte`、`--base-color #ffffff`、`--debug-uv`（把面板名画到车上）、`--no-sheet`。

可用视角：`front_left`、`front`、`left`、`rear_right`、`rear`、`right`、`top`（俯视，车头朝上）。

**输出约定**：stdout 上只输出一个 JSON 文档，进度信息走 stderr。退出码 `0` 表示成功且符合 Tesla 全部硬性要求，`1` 表示已渲染或检查完但有错误，`2` 表示用法错误或运行失败（此时 JSON 为 `{ ok: false, error, kind }`）。同一输入、同一参数的渲染结果每次逐像素一致（强制使用 SwiftShader，见 [ADR 0002](docs/adr/0002-cli-renders-through-headless-chromium.md)），可以直接对比前后两次迭代。

`check` / `render` 的 JSON（节选）：

```json
{
  "ok": true,
  "errors": 0,
  "warnings": 1,
  "issues": [
    { "level": "warning", "code": "panel_not_filled", "panel": "mirror_left", "message": "mirror_left is only 97.2% opaque; ..." }
  ],
  "coverage": {
    "overall": 0.999,
    "outsideOpaqueRatio": 0.03,
    "panels": [{ "name": "hood", "label": "引擎盖", "coverage": 1, "meanColor": "#423b2a" }]
  },
  "outputs": { "sheet": "/abs/out/sheet.png", "views": { "left": { "file": "/abs/out/views/left.png" } } }
}
```

问题代码：`not_png`、`file_name_chars`、`file_name_length`、`file_too_large`、`dimensions_out_of_range`、`aspect_mismatch`（以上为 error）；`file_near_limit`、`not_template_size`、`panel_not_filled`（以上为 warning）。

### 推荐的 agent 迭代流程

1. 运行 `wrap-preview template --out ./tpl`，读取 `panels.json` 和 `panels-guide.png`，搞清楚每块面板在 PNG 里的位置和方向。
2. 生成 1024×1024 的 PNG：面板区域全部不透明填满，文件名只用字母、数字、`_`、`-`、空格，文件 ≤ 1 MB。
3. 运行 `wrap-preview check`，修正所有 error，关注 `panel_not_filled`。
4. 运行 `wrap-preview render --out ./iter-N`，查看 `sheet.png`。接缝、文字方向有疑问时加 `--debug-uv` 再渲染一次。
5. 根据渲染结果修改 PNG，回到第 3 步。

### 面板方向（Model Y）

模板里车头在上方，左右以驾驶座视角为准。`panels.json` 中每块面板的 `orientation` 字段是从车模 UV 自动推导出来的：`imageRight` / `imageUp` 表示 PNG 的 x 轴和"上"方向在这块面板上对应车身的哪个方向，`mirrored` 表示从车外看是否镜像。例如：

| 面板 | PNG 向右 → 车身 | PNG 向上 → 车身 | 说明 |
|------|------|------|------|
| `hood` | 右 | 前 | 俯视时正向可读 |
| `door_*_left`、`quarter_panel_left` | 上 | 前 | 文字在 PNG 里顺时针转 90° 后，在车身上横向可读 |
| `door_*_right`、`quarter_panel_right` | 下 | 前 | 文字在 PNG 里逆时针转 90° |
| `bumper_front` | 右 | 下 | 从车前看是倒置的（旋转 180°） |
| `liftgate`、`bumper_rear` | 右 | 上 | 从车后看正向可读 |

## 目录结构

```text
src/
├── core/         # 与运行环境无关：车型配置、面板类型、合规检查
├── render/       # three.js 查看器（网页和无头页共用）、视角、程序化轮毂
├── main.ts       # 网页 UI
└── headless.ts   # CLI 驱动的无头页（window.wrapPreview）
cli/              # wrap-preview 命令行：构建 / 本地服务 / Playwright
scripts/
├── build-vehicle.ts   # 从上游固定 commit 重建 public/vehicles/modely/*
└── fetch-assets.ts    # 下载 Tesla 官方模板和示例（不入库）
public/vehicles/modely/
├── model.glb     # 车机原版车模（meshopt 压缩，贴膜面已标记）
├── panels.png    # 面板标签图（模板分辨率）
└── panels.json   # 面板名、bbox、方向
```

## 开发

```bash
npm test            # 单元测试 + CLI 端到端测试（会真实渲染一次）
npm run typecheck
npm run build-vehicle   # 从上游重新生成车模和面板数据（sha256 校验）
```

## 已知限制

- 目前只有 Model Y（2020–2024）一个车型。车型配置已经抽象好（`src/core/vehicles.ts`），拿到其他车型的车机模型后可以直接添加。
- 上游车模只带 4×4 的占位贴图，所以车漆、玻璃、灯组、内饰材质都是按角色重建的近似效果；轮毂是程序化生成的。光照和车机界面不完全一致，但贴膜的位置、接缝和方向与车机一致。
- Tesla 没有说明透明像素在车上显示成什么，这里按"底漆颜色"处理，并在报告中提示。
