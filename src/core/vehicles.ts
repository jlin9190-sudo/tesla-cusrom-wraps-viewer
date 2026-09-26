export type MaterialRole = 'wrap' | 'trim' | 'glass' | 'glassInterior' | 'lightGlass' | 'light' | 'chrome' | 'rubber' | 'interior' | 'hidden';

export interface WheelSpec {
  /** Empty nodes in the model marking each wheel hub centre. */
  nodes: string[];
  tireRadius: number;
  tireWidth: number;
  rimRadius: number;
}

export interface VehicleProfile {
  id: string;
  name: string;
  /** Folder name in teslamotors/custom-wraps. */
  customWrapsDir: string;
  /** Asset paths relative to the web root. */
  modelUrl: string;
  panelsUrl: string;
  panelsJsonUrl: string;
  templateSize: [number, number];
  /** Material name → rendering role. Unlisted materials render as `interior`. */
  materialRoles: Record<string, MaterialRole>;
  hiddenNodes: string[];
  wheels: WheelSpec;
}

const MODEL_Y: VehicleProfile = {
  id: 'modely',
  name: 'Model Y (2020–2024)',
  customWrapsDir: 'modely',
  modelUrl: 'vehicles/modely/model.glb',
  panelsUrl: 'vehicles/modely/panels.png',
  panelsJsonUrl: 'vehicles/modely/panels.json',
  templateSize: [1024, 1024],
  materialRoles: {
    Paint: 'wrap',
    PaintRough: 'wrap',
    PaintFade: 'wrap',
    WrapExterior: 'wrap',
    Exterior: 'trim',
    ExteriorFade: 'trim',
    Glass: 'glass',
    Glass_Tinted: 'glass',
    Glass_Fade: 'glass',
    Glass_Tinted_Fade: 'glass',
    Glass_Interior: 'glassInterior',
    Glass_Interior_Tinted: 'glassInterior',
    Glass_Interior_Fade: 'glassInterior',
    Glass_Interior_Tinted_Fade: 'glassInterior',
    Glass_Lights: 'lightGlass',
    Lights2: 'light',
    LightsFade: 'light',
    Chrome: 'chrome',
    MirrorFade: 'chrome',
    Rubber: 'rubber',
    Chargeport: 'trim',
    Plates: 'hidden',
  },
  hiddenNodes: ['Plate_US'],
  wheels: {
    nodes: ['Wheel_LF_Spatial', 'Wheel_RF_Spatial', 'Wheel_LR_Spatial', 'Wheel_RR_Spatial'],
    // Roughly a 255/45R19 Gemini wheel; radius matches the hub height so tyres touch the y=0 ground.
    tireRadius: 0.345,
    tireWidth: 0.255,
    rimRadius: 0.2413,
  },
};

export const VEHICLES: Record<string, VehicleProfile> = { [MODEL_Y.id]: MODEL_Y };
export const DEFAULT_VEHICLE = MODEL_Y.id;

export function getVehicle(id: string): VehicleProfile {
  const v = VEHICLES[id];
  if (!v) throw new Error(`Unknown vehicle "${id}". Available: ${Object.keys(VEHICLES).join(', ')}`);
  return v;
}
