import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'
export type Bi = { en: string; zh: string }

const STR = {
  appTitle:       { en: 'QC Inspection',              zh: '质检系统' },
  signIn:         { en: 'Sign in',                    zh: '登录' },
  signOut:        { en: 'Sign out',                   zh: '退出' },
  email:          { en: 'Email',                      zh: '邮箱' },
  password:       { en: 'Password',                   zh: '密码' },
  staySignedIn:   { en: 'Stay signed in on this device', zh: '在此设备保持登录' },
  newInspection:  { en: 'New Inspection',             zh: '新建检验' },
  myInspections:  { en: 'My Inspections',             zh: '我的检验' },
  allInspections: { en: 'All Inspections',            zh: '全部检验' },
  partNo:         { en: 'Part No. / SKU',             zh: '产品编号' },
  poNo:           { en: 'PO No.',                     zh: '订单号' },
  batch:          { en: 'Batch / date stamp',         zh: '批次/日期' },
  lotSize:        { en: 'Lot size (pcs)',             zh: '批量（件）' },
  appSample:      { en: 'Appearance sample',          zh: '外观抽样' },
  funSample:      { en: 'Functional sample',          zh: '功能抽样' },
  start:          { en: 'Start Inspection',           zh: '开始检验' },
  tabVisual:      { en: 'Visual',                     zh: '外观' },
  tabTechnical:   { en: 'Technical',                  zh: '技术' },
  tabPhotos:      { en: 'Photos',                     zh: '照片' },
  tabPallet:      { en: 'Pallet',                     zh: '托盘' },
  tabSummary:     { en: 'Summary',                    zh: '汇总' },
  tab100pct:      { en: '⛔ 100% Check',              zh: '⛔ 全检' },
  piece:          { en: 'Piece',                      zh: '件号' },
  addDefect:      { en: 'Log Defect',                 zh: '记录缺陷' },
  defectType:     { en: 'Defect type',                zh: '缺陷类型' },
  sizeMm:         { en: 'Size (mm)',                  zh: '尺寸(mm)' },
  severity:       { en: 'Severity',                   zh: '严重度' },
  critical:       { en: 'Critical',                   zh: '严重' },
  major:          { en: 'Major',                      zh: '主要' },
  minor:          { en: 'Minor',                      zh: '轻微' },
  takePhoto:      { en: 'Take photo',                 zh: '拍照' },
  save:           { en: 'Save',                       zh: '保存' },
  submit:         { en: 'Submit for Approval',        zh: '提交审批' },
  approve:        { en: 'Approve',                    zh: '批准' },
  reject:         { en: 'Reject',                     zh: '退回' },
  approvals:      { en: 'Approvals',                  zh: '审批' },
  settings:       { en: 'Settings',                   zh: '设置' },
  skus:           { en: 'SKUs',                       zh: 'SKU管理' },
  refLibrary:     { en: 'Reference Photos',           zh: '参考照片' },
  nominal:        { en: 'Nominal',                    zh: '标称' },
  tolerance:      { en: 'Tolerance',                  zh: '公差' },
  result:         { en: 'Result',                     zh: '判定' },
  status:         { en: 'Status',                     zh: '状态' },
  remarks:        { en: 'Remarks',                    zh: '备注' },
  disposition:    { en: 'Final disposition',          zh: '最终处置' },
  allClean:       { en: 'No defects flagged — on track', zh: '暂无缺陷——正常' },
  extraNeeded:    { en: 'Inspect extra pieces for',   zh: '需加检：' },
  fullInsp:       { en: '100% INSPECTION required',  zh: '需全检' },
  monitor:        { en: 'Below trigger — record & monitor', zh: '低于阈值——记录监控' },
  updated:        { en: 'Updated',                    zh: '更新' },
  submitted:      { en: 'Submitted',                  zh: '提交' },
  po:             { en: 'PO',                         zh: '订单' },
  lot:            { en: 'Lot',                        zh: '批量' },
  defectsLogged:  { en: 'Defects logged',             zh: '已记录缺陷' },
  photosTaken:    { en: 'Photos taken',               zh: '已拍照片' },
  release:        { en: 'RELEASE',                    zh: '放行' },
  releaseRecord:  { en: 'RELEASE WITH RECORD',        zh: '记录放行' },
  hold100:        { en: 'HOLD — 100% INSPECTION',     zh: '全检待定' },
  rejectDisp:     { en: 'REJECT',                     zh: '拒收' },
  requiredShots:  { en: 'Required Shots',             zh: '必拍照片' },
  allPhotos:      { en: 'All Photos',                 zh: '所有照片' },
  take:           { en: 'Take',                       zh: '拍摄' },
  assign:         { en: 'Assign',                     zh: '指定' },
  notTaken:       { en: 'Not taken',                  zh: '未拍' },
  passPhoto:      { en: 'Pass — Take Photo',          zh: '合格拍照' },
  failDefect:     { en: 'Fail — Log Defect',          zh: '不合格记录' },
  saveDefect:     { en: 'Save Defect',                zh: '保存缺陷' },
  cancel:         { en: 'Cancel',                     zh: '取消' },
  comment:        { en: 'Comment (optional)',         zh: '备注（可选）' },
  measurement:    { en: 'Measurement',                zh: '测量值' },
  inspParam:      { en: 'Inspected Parameter',        zh: '检验项目' },
  allPass:        { en: 'All P',                      zh: '全部合格' },
  allFail:        { en: 'All F',                      zh: '全部不合格' },
  allNA:          { en: 'All NA',                     zh: '全部不适用' },
  undo:           { en: '↩ Undo',                     zh: '↩ 撤销' },
  refStandard:    { en: 'View standard reference',    zh: '查看标准参考' },
  close:          { en: 'Close',                      zh: '关闭' },
  submitConfirm:  { en: 'Submit this inspection for approval?', zh: '确认提交此检验单审批？' },
  submitWarning:  { en: 'Once submitted, you cannot make changes unless the approver returns it.', zh: '提交后，除非审批人退回，否则无法修改。' },
  noPhotoYet:     { en: 'No photos yet',              zh: '暂无照片' },
  noDefectsYet:   { en: 'No defects logged.',         zh: '暂无缺陷记录。' },
  extraPiece:     { en: 'Extra piece',                zh: '加检件' },
  of:             { en: 'of',                         zh: '/' },
  checked:        { en: 'Checked',                    zh: '已检' },
  fails:          { en: 'Fails',                      zh: '不合格' },
  remaining:      { en: 'Remaining',                  zh: '待检' },
  checkingFor:    { en: 'Checking for',               zh: '检查项目' },
  pdfReport:      { en: '📄 PDF Report',               zh: '📄 PDF报告' },
} satisfies Record<string, Bi>

type Key = keyof typeof STR
const Ctx = createContext<{
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key) => string
  bi: (b: Bi) => string
}>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'en')
  const set = (l: Lang) => { localStorage.setItem('lang', l); setLang(l) }
  const t = (k: Key) => STR[k][lang]
  const bi = (b: Bi) => b[lang]
  return <Ctx.Provider value={{ lang, setLang: set, t, bi }}>{children}</Ctx.Provider>
}
export const useI18n = () => useContext(Ctx)
