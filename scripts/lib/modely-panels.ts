/**
 * Names the wrap UV islands of the Model Y in-car model.
 * World frame of the source model: +Y up, front of the car towards -Z, driver's left towards -X.
 */

export interface ComponentInfo {
  node: string;
  pixels: number;
  /** [minX, minY, maxX, maxY] in template pixels. */
  bbox: [number, number, number, number];
  centroidUv: [number, number];
  centroid3d: [number, number, number];
}

export interface PanelRule {
  name: string;
  label: string;
  description: string;
  match: (c: ComponentInfo) => boolean;
}

const isLeft = (c: ComponentInfo) => c.centroid3d[0] < 0;
const body = (c: ComponentInfo) => c.node === 'Body';
const node = (name: string) => (c: ComponentInfo) => c.node === name;

export const MODEL_Y_PANEL_RULES: PanelRule[] = [
  { name: 'hood', label: '引擎盖', description: 'Front hood (frunk lid), seen from above', match: node('Hood') },
  { name: 'liftgate', label: '尾门', description: 'Rear liftgate around the rear window, including the lower tailgate panel', match: node('Trunk') },
  { name: 'bumper_front', label: '前保险杠', description: 'Front bumper / nose fascia', match: (c) => body(c) && c.centroid3d[2] < -1.9 },
  { name: 'bumper_rear', label: '后保险杠', description: 'Rear bumper fascia', match: (c) => body(c) && c.centroid3d[2] > 1.9 && c.centroid3d[1] < 0.8 },
  { name: 'fender_front_left', label: '左前翼子板', description: 'Driver-side front fender, from headlight to front door', match: (c) => body(c) && isLeft(c) && c.centroid3d[2] < -1 && c.centroid3d[2] > -1.9 },
  { name: 'fender_front_right', label: '右前翼子板', description: 'Passenger-side front fender, from headlight to front door', match: (c) => body(c) && !isLeft(c) && c.centroid3d[2] < -1 && c.centroid3d[2] > -1.9 },
  { name: 'quarter_panel_left', label: '左后翼子板', description: 'Driver-side rear quarter panel, from rear door to taillight', match: (c) => body(c) && isLeft(c) && c.centroid3d[2] > 1 && c.centroid3d[1] < 1.3 },
  { name: 'quarter_panel_right', label: '右后翼子板', description: 'Passenger-side rear quarter panel, from rear door to taillight', match: (c) => body(c) && !isLeft(c) && c.centroid3d[2] > 1 && c.centroid3d[1] < 1.3 },
  { name: 'roof_rail_left', label: '左车顶侧梁', description: 'Driver-side A-pillar and roof rail strip beside the glass roof', match: (c) => body(c) && isLeft(c) && c.centroid3d[1] > 1.3 },
  { name: 'roof_rail_right', label: '右车顶侧梁', description: 'Passenger-side A-pillar and roof rail strip beside the glass roof', match: (c) => body(c) && !isLeft(c) && c.centroid3d[1] > 1.3 },
  { name: 'door_front_left', label: '左前门', description: 'Driver-side front door', match: node('Door_LF') },
  { name: 'door_front_right', label: '右前门', description: 'Passenger-side front door', match: node('Door_RF') },
  { name: 'door_rear_left', label: '左后门', description: 'Driver-side rear door', match: node('Door_LR') },
  { name: 'door_rear_right', label: '右后门', description: 'Passenger-side rear door', match: node('Door_RR') },
  { name: 'mirror_left', label: '左后视镜', description: 'Driver-side mirror cap', match: node('Door_LF_Mirror') },
  { name: 'mirror_right', label: '右后视镜', description: 'Passenger-side mirror cap', match: node('Door_RF_Mirror') },
];

export function nameComponent(c: ComponentInfo): string | undefined {
  return MODEL_Y_PANEL_RULES.find((r) => r.match(c))?.name;
}
