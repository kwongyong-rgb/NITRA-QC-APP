import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Lang, Bi } from './standard'

const STR = {
  appTitle: { en: 'QC Inspection', zh: '质检' },
  signIn: { en: 'Sign in', zh: '登录' },
  signOut: { en: 'Sign out', zh: '退出' },
  email: { en: 'Email', zh: '邮箱' },
  password: { en: 'Password', zh: '密码' },
  newInspection: { en: 'New inspection', zh: '新建检验' },
  myInspections: { en: 'My inspections', zh: '我的检验' },
  allInspections: { en: 'All inspections', zh: '全部检验' },
  partNo: { en: 'Part No. / SKU', zh: '产品编号' },
  poNo: { en: 'PO No.', zh: '订单号' },
  batch: { en: 'Batch / date stamp', zh: '批次/日期' },
  lotSize: { en: 'Lot size (pcs)', zh: '批量（件）' },
  appSample: { en: 'Appearance sample', zh: '外观抽样' },
  funSample: { en: 'Functional sample', zh: '功能抽样' },
  start: { en: 'Start inspection', zh: '开始检验' },
  form: { en: 'Form', zh: '检验表' },
  measure: { en: 'Measure', zh: '测量' },
  defects: { en: 'Defects', zh: '缺陷' },
  photos: { en: 'Photos', zh: '照片' },
  pallet: { en: 'Pallet', zh: '托盘' },
  summary: { en: 'Summary', zh: '汇总' },
  piece: { en: 'Piece', zh: '件' },
  addDefect: { en: 'Log defect + photo', zh: '记录缺陷并拍照' },
  defectType: { en: 'Defect type', zh: '缺陷类型' },
  sizeMm: { en: 'Size (mm)', zh: '尺寸(mm)' },
  severity: { en: 'Severity', zh: '严重度' },
  critical: { en: 'Critical', zh: '严重' },
  major: { en: 'Major', zh: '主要' },
  minor: { en: 'Minor', zh: '轻微' },
  takePhoto: { en: 'Take photo', zh: '拍照' },
  save: { en: 'Save', zh: '保存' },
  submit: { en: 'Submit for approval', zh: '提交审批' },
  approve: { en: 'Approve', zh: '批准' },
  reject: { en: 'Reject', zh: '退回' },
  approvals: { en: 'Approvals', zh: '审批' },
  settings: { en: 'Settings', zh: '设置' },
  skus: { en: 'SKUs', zh: 'SKU管理' },
  refLibrary: { en: 'Reference photos', zh: '参考照片' },
  extraNeeded: { en: 'Inspect {n} extra piece(s) for', zh: '需加检{n}件：' },
  fullInspection: { en: '100% INSPECTION required (whole batch) for', zh: '需全检（整批）：' },
  monitor: { en: 'Below trigger — record & monitor', zh: '低于阈值——记录并监控' },
  allClean: { en: 'No defects logged — on track', zh: '暂无缺陷——正常' },
  nominal: { en: 'Nominal', zh: '标称' },
  tolerance: { en: 'Tolerance', zh: '公差' },
  result: { en: 'Result', zh: '判定' },
  status: { en: 'Status', zh: '状态' },
  markExtras: { en: 'Extras inspected', zh: '已加检数' },
  remarks: { en: 'Remarks', zh: '备注' },
  disposition: { en: 'Final disposition', zh: '最终处置' },
  sendReport: { en: 'Send report (PDF + email)', zh: '发送报告' },
} satisfies Record<string, Bi>

type Key = keyof typeof STR
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string; bi: (b: Bi) => string }>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'en')
  const set = (l: Lang) => { localStorage.setItem('lang', l); setLang(l) }
  const t = (k: Key, vars?: Record<string, string | number>) => {
    let s = STR[k][lang]
    if (vars) for (const [vk, vv] of Object.entries(vars)) s = s.replace(`{${vk}}`, String(vv))
    return s
  }
  const bi = (b: Bi) => b[lang]
  return <Ctx.Provider value={{ lang, setLang: set, t, bi }}>{children}</Ctx.Provider>
}
export const useI18n = () => useContext(Ctx)
