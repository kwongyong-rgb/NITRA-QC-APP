// ============================================================
// NITRA Alloy Wheel Quality Standard — V18 + approved changes
// (coating: min between 120–130 µm total, ≥80 µm machined)
// ============================================================
export type Lang = 'en' | 'zh'
export type Bi = { en: string; zh: string }

export interface ChecklistItem {
  key: string
  group: 'A' | 'Fn'          // Appearance / Functional sampling group
  label: Bi
  standard: Bi
}
export interface Section { key: string; title: Bi; items: ChecklistItem[] }

export const SECTIONS: Section[] = [
  {
    key: 'APPEARANCE',
    title: { en: 'Appearance', zh: '外观' },
    items: [
      { key: 'inspect_cond', group: 'A', label: { en: 'Inspect conditions', zh: '检验条件' },
        standard: { en: '100 cm distance, ≥1,000 lux, vs approved master sample', zh: '距离100cm，≥1,000勒克斯，对照标准样品' } },
      { key: 'area_a', group: 'A', label: { en: 'Area A — Front / design', zh: 'A区 — 设计面' },
        standard: { en: 'Paint 3×≤0.8mm · porosity 2×≤1.0mm · scratch 1×≤5mm · dist 75mm', zh: '漆点3×≤0.8mm · 砂孔2×≤1.0mm · 划痕1×≤5mm · 间距75mm' } },
      { key: 'area_b', group: 'A', label: { en: 'Area B — Window', zh: 'B区 — 窗口区' },
        standard: { en: 'Paint 2×≤1.5mm · porosity 2×≤1.0mm · scratch 2×≤5mm · dist 50mm', zh: '漆点2×≤1.5mm · 砂孔2×≤1.0mm · 划痕2×≤5mm · 间距50mm' } },
      { key: 'area_c', group: 'A', label: { en: 'Area C — Rim well outside', zh: 'C区 — 轮辋外侧' },
        standard: { en: 'Paint 3×≤2.0mm · porosity 3×≤1.0mm · scratch 3×≤5mm · dist 50mm', zh: '漆点3×≤2.0mm · 砂孔3×≤1.0mm · 划痕3×≤5mm · 间距50mm' } },
      { key: 'area_c1', group: 'A', label: { en: 'Area C1 — Rim well inside', zh: 'C1区 — 轮辋内侧' },
        standard: { en: 'Paint 3×≤1.0mm · porosity 2×≤1.0mm · scratch 1×≤5mm · dist 100mm', zh: '漆点3×≤1.0mm · 砂孔2×≤1.0mm · 划痕1×≤5mm · 间距100mm' } },
      { key: 'area_d', group: 'A', label: { en: 'Area D — Rim horn inside', zh: 'D区 — 轮缘内侧' },
        standard: { en: 'Paint 3×≤1.0mm · porosity 3×≤1.0mm · scratch 5×≤5mm · dist 100mm', zh: '漆点3×≤1.0mm · 砂孔3×≤1.0mm · 划痕5×≤5mm · 间距100mm' } },
      { key: 'area_e', group: 'A', label: { en: 'Area E — Valve hole', zh: 'E区 — 气门孔' },
        standard: { en: 'Free of burrs', zh: '无毛刺' } },
    ],
  },
  {
    key: 'FINISH',
    title: { en: 'Finish', zh: '涂装' },
    items: [
      { key: 'colour_match', group: 'A', label: { en: 'Colour match wheel vs cap', zh: '轮毂与盖颜色一致' },
        standard: { en: 'Same as approved sample', zh: '与认可样品一致' } },
      { key: 'cap_fitment', group: 'A', label: { en: 'Cap fitment', zh: '盖子配合' },
        standard: { en: 'Cap fits tightly on wheel', zh: '盖子须紧密配合轮毂' } },
      { key: 'logo', group: 'A', label: { en: 'Logo', zh: '标志' },
        standard: { en: 'Same as approved sample', zh: '与认可样品一致' } },
      { key: 'bolt_cone_paint', group: 'A', label: { en: 'Bolt hole / cone free of paint', zh: '螺栓孔/锥座无涂料' },
        standard: { en: 'Free of paint (Standard p.5)', zh: '无涂料（标准第5页）' } },
      { key: 'rear_bore_paint', group: 'A', label: { en: 'Rear centre bore + mounting face paint-free', zh: '背面中心孔/安装面无涂料' },
        standard: { en: 'Free of paint (Standard p.5)', zh: '无涂料（标准第5页）' } },
      { key: 'hat_marks', group: 'A', label: { en: 'No hat marks', zh: '无压痕' },
        standard: { en: 'Wheel face free of visible hat marks (Standard p.5)', zh: '正面无可见压痕（标准第5页）' } },
      { key: 'orange_peel', group: 'A', label: { en: 'Smooth surface, no orange peel', zh: '表面光滑无橘皮' },
        standard: { en: 'Per SOP', zh: '按SOP' } },
      { key: 'cap_finish', group: 'A', label: { en: 'Cap surface finish', zh: '盖子表面处理' },
        standard: { en: 'Matches approved wheel finish sample (Standard p.5)', zh: '与认可轮毂样品一致（标准第5页）' } },
      { key: 'tpms', group: 'A', label: { en: 'TPMS (if fitted)', zh: 'TPMS（如有）' },
        standard: { en: 'Same as sample (company spec — confirm w/ SKU)', zh: '与样品一致（公司规格）' } },
      { key: 'coating_total', group: 'A', label: { en: 'Total coating thickness', zh: '涂层总厚度' },
        standard: { en: 'Min. between 120–130 µm (Standard p.5)', zh: '最小120至130µm（标准第5页）' } },
      { key: 'coating_machined', group: 'A', label: { en: 'Machined-area coating', zh: '加工面涂层' },
        standard: { en: 'Powder ≥80 µm (Standard p.5)', zh: '粉末≥80µm（标准第5页）' } },
    ],
  },
  {
    key: 'MARKING',
    title: { en: 'Marking', zh: '标识' },
    items: [
      { key: 'laser_format', group: 'Fn', label: { en: 'Laser engraving format', zh: '激光雕刻格式' },
        standard: { en: 'Model/SIZE/PCD/CB/ET/MAX LOAD/PROD DATE per sample', zh: '按样本格式' } },
      { key: 'mark_sae', group: 'Fn', label: { en: 'Back marking — SAE J2530', zh: '背面标识 — SAE J2530' },
        standard: { en: 'Stamped, legible, permanent', zh: '冲压清晰永久' } },
      { key: 'mark_size', group: 'Fn', label: { en: 'Back marking — SIZE', zh: '背面标识 — 尺寸' },
        standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_pcd', group: 'Fn', label: { en: 'Back marking — PCD', zh: '背面标识 — 节圆直径' },
        standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_cb', group: 'Fn', label: { en: 'Back marking — CB', zh: '背面标识 — 中心孔' },
        standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_et', group: 'Fn', label: { en: 'Back marking — ET', zh: '背面标识 — 偏距' },
        standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_nitra', group: 'Fn', label: { en: 'Back marking — NITRA brand', zh: '背面标识 — 品牌' },
        standard: { en: 'Stamped clearly and permanently', zh: '清晰永久冲压' } },
    ],
  },
  {
    key: 'PACKING',
    title: { en: 'Packing', zh: '包装' },
    items: [
      { key: 'pk_cap', group: 'Fn', label: { en: 'Step 1 — cap on wheel', zh: '第一步：扣盖' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_foam', group: 'Fn', label: { en: 'Foam/cling on gloss black', zh: '亮黑泡沫/保鲜膜' }, standard: { en: 'Prevent hat marks', zh: '防压痕' } },
      { key: 'pk_cloth', group: 'Fn', label: { en: 'Step 2 — face cloth cover', zh: '第二步：面防护布套' }, standard: { en: '+ pearl cotton', zh: '加珍珠棉' } },
      { key: 'pk_hoop', group: 'Fn', label: { en: 'Step 3 — plastic hoop', zh: '第三步：塑料护圈' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_bag', group: 'Fn', label: { en: 'Step 4 — plastic bag', zh: '第四步：塑料袋' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_toppad', group: 'Fn', label: { en: 'Step 5 — protective top pad', zh: '第五步：顶部纸护垫' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_sideboard', group: 'Fn', label: { en: 'Side boards each side', zh: '两侧护角' }, standard: { en: '30cm ≤17", 40cm ≥18"', zh: '17寸及以下30CM，18寸及以上40CM' } },
      { key: 'pk_fullface', group: 'Fn', label: { en: 'Full-face cap taped at box bottom', zh: '全盖式盖子贴箱底' }, standard: { en: 'If full-face cap', zh: '全盖式适用' } },
    ],
  },
  {
    key: 'BOX',
    title: { en: 'Box & Label', zh: '纸箱标签' },
    items: [
      { key: 'bx_design', group: 'Fn', label: { en: 'Box design matches sample', zh: '纸箱设计一致' }, standard: { en: 'Match sample exactly', zh: '与样品完全一致' } },
      { key: 'bx_label', group: 'Fn', label: { en: 'Box label format & size', zh: '标签格式与尺寸' }, standard: { en: 'W80×H120mm, barcode W44mm', zh: '宽80×高120mm，条码宽44mm' } },
      { key: 'bx_upc', group: 'Fn', label: { en: 'UPC-A scans', zh: '条码可扫描' }, standard: { en: 'Scans correctly', zh: '可正常扫描' } },
      { key: 'bx_proddate', group: 'Fn', label: { en: 'Production date below UPC', zh: 'UPC下方生产日期' }, standard: { en: 'Directly below barcode', zh: '条码正下方' } },
      { key: 'bx_stick', group: 'Fn', label: { en: 'Stick-on label square, no slant', zh: '标贴端正无歪斜' }, standard: { en: 'Within designated area', zh: '指定方框内' } },
    ],
  },
]

// ---------- measurement columns (per SKU tolerances) ----------
export interface MeasCol {
  key: string
  label: Bi
  nominal: (sku: Sku) => number | null
  tol: Bi
  check: (v: number, sku: Sku) => boolean
}
export interface Sku {
  part_no: string; model: string; size: string; diameter_in: number
  pcd: string; offset_mm: number; offset_txt: string; cb_mm: number
  lug_hole_mm: number; counter_bore_mm: number; seat_thickness_mm: number
  lug_seat_type: string; finish: string; max_load_lbs: number
}

export function runoutLimits(d: number) {
  if (d < 17) return { radial: 0.4, axial: 0.4 }
  if (d <= 19) return { radial: 0.5, axial: 0.4 }
  return { radial: 0.6, axial: 0.5 }
}
export function balanceLimits(d: number) {
  if (d < 13) return { B: 20, C: 20, BC: 30 }
  if (d <= 14) return { B: 25, C: 25, BC: 40 }
  if (d <= 15) return { B: 30, C: 30, BC: 50 }
  if (d <= 16) return { B: 35, C: 35, BC: 60 }
  if (d <= 17) return { B: 30, C: 40, BC: 65 }
  if (d <= 18) return { B: 35, C: 45, BC: 70 }
  if (d <= 19) return { B: 40, C: 50, BC: 75 }
  if (d <= 22) return { B: 40, C: 55, BC: 80 }
  return { B: 40, C: 60, BC: 80 }
}

export interface MeasSection { key: string; title: Bi; cols: MeasCol[] }

export const MEAS_SECTIONS: MeasSection[] = [
  {
    key: 'machining',
    title: { en: 'Wheel Machining', zh: '轮毂加工' },
    cols: [
      { key: 'counter_bore', label: { en: 'Counter bore', zh: '埋头孔' },
        nominal: s => s.counter_bore_mm, tol: { en: '±0.50 mm', zh: '±0.50 mm' },
        check: (v, s) => Math.abs(v - s.counter_bore_mm) <= 0.5 },
      { key: 'lug_hole', label: { en: 'Lug hole', zh: '螺栓孔' },
        nominal: s => s.lug_hole_mm, tol: { en: '±0.25 mm', zh: '±0.25 mm' },
        check: (v, s) => Math.abs(v - s.lug_hole_mm) <= 0.25 },
      { key: 'seat_thick', label: { en: 'Seat thickness', zh: '座厚' },
        nominal: s => s.seat_thickness_mm, tol: { en: '±0.50 mm', zh: '±0.50 mm' },
        check: (v, s) => Math.abs(v - s.seat_thickness_mm) <= 0.5 },
      { key: 'offset', label: { en: 'Offset ET', zh: '偏距' },
        nominal: s => s.offset_mm, tol: { en: '±1.00 mm', zh: '±1.00 mm' },
        check: (v, s) => Math.abs(v - s.offset_mm) <= 1.0 },
      { key: 'cb', label: { en: 'Center bore CB', zh: '中心孔' },
        nominal: s => s.cb_mm, tol: { en: '+0/+0.10 mm', zh: '+0/+0.10 mm' },
        check: (v, s) => v - s.cb_mm >= 0 && v - s.cb_mm <= 0.10 },
    ],
  },
  {
    key: 'oor',
    title: { en: 'Wheel OOR', zh: '轮毂偏摆' },
    cols: [
      { key: 'radial_top', label: { en: 'Radial top', zh: '径向上' },
        nominal: s => runoutLimits(s.diameter_in).radial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).radial },
      { key: 'radial_bot', label: { en: 'Radial bottom', zh: '径向下' },
        nominal: s => runoutLimits(s.diameter_in).radial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).radial },
      { key: 'axial_top', label: { en: 'Axial top', zh: '轴向上' },
        nominal: s => runoutLimits(s.diameter_in).axial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).axial },
      { key: 'axial_bot', label: { en: 'Axial bottom', zh: '轴向下' },
        nominal: s => runoutLimits(s.diameter_in).axial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).axial },
    ],
  },
  {
    key: 'balance',
    title: { en: 'Wheel Balance', zh: '轮毂动平衡' },
    cols: [
      { key: 'bal_b', label: { en: 'Balance B (g)', zh: '平衡B(g)' },
        nominal: s => balanceLimits(s.diameter_in).B, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).B },
      { key: 'bal_c', label: { en: 'Balance C (g)', zh: '平衡C(g)' },
        nominal: s => balanceLimits(s.diameter_in).C, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).C },
      { key: 'bal_bc', label: { en: 'Balance B+C (g)', zh: '平衡B+C(g)' },
        nominal: s => balanceLimits(s.diameter_in).BC, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).BC },
    ],
  },
]

export const MEAS_COLS: MeasCol[] = MEAS_SECTIONS.flatMap(s => s.cols)

// photo checklist slots
export const PHOTO_SLOTS: { key: string; label: Bi }[] = [
  { key: 'batch_laser', label: { en: 'Batch no. / laser engraving', zh: '批次号/激光雕刻' } },
  { key: 'wheel_front', label: { en: 'Wheel front face', zh: '轮毂正面' } },
  { key: 'wheel_back', label: { en: 'Wheel back + markings', zh: '轮毂背面及标识' } },
  { key: 'box_label', label: { en: 'Box label + UPC', zh: '纸箱标签及条码' } },
  { key: 'packing_inside', label: { en: 'Packing layers inside box', zh: '箱内包装层' } },
  { key: 'pallet_full', label: { en: 'Each pallet w/ labels', zh: '托盘及标签' } },
  { key: 'container_empty', label: { en: 'Container empty + damage', zh: '空柜及破损' } },
  { key: 'container_half', label: { en: 'Container half full', zh: '半柜' } },
  { key: 'container_full', label: { en: 'Container full', zh: '满柜' } },
  { key: 'container_door', label: { en: 'Container door (# legible)', zh: '柜门(箱号清晰)' } },
  { key: 'container_seal', label: { en: 'Seal # (legible)', zh: '封号(清晰)' } },
]

// pallet & container checklist
export const PALLET_ITEMS: { key: string; label: Bi }[] = [
  { key: 'pl_grouped', label: { en: 'Wheels stacked & grouped by part no.', zh: '按产品编号分类堆叠' } },
  { key: 'pl_wood', label: { en: 'Fumigation-free solid-wood pallet', zh: '免熏蒸实木托盘' } },
  { key: 'pl_height', label: { en: 'Height ≤254 cm, 3-inch fork gap', zh: '高≤254cm，留3英寸叉车位' } },
  { key: 'pl_straps', label: { en: '4 straps tight', zh: '4根打包带捆扎牢固' } },
  { key: 'pl_wrap', label: { en: 'Wrap ≥3 layers, ≥0.35 mm, tight', zh: '缠绕≥3层，≥0.35mm，紧实' } },
  { key: 'pl_label4', label: { en: 'Pallet label on all 4 sides (A4, 4/sheet)', zh: '四面贴托盘标签(A4每张4个)' } },
  { key: 'pl_photo', label: { en: 'Photo of each pallet taken', zh: '每托盘拍照' } },
  { key: 'ct_photo_before', label: { en: 'Container damage + empty photographed', zh: '装柜前破损/空柜拍照' } },
  { key: 'ct_labels_doors', label: { en: 'Box labels + hand-holes face doors', zh: '标签面/把手孔朝柜门' } },
  { key: 'ct_no_loose', label: { en: 'No loose wheels', zh: '无散装轮毂' } },
  { key: 'ct_spares_front', label: { en: 'Spare boxes/caps at front', zh: '备用箱/盖置于柜门口' } },
  { key: 'ct_net', label: { en: 'Net/rope before closing doors', zh: '关门前装防护网/绳' } },
]
