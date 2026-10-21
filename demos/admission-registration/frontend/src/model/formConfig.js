export const SHORTCUTS = [
  '住院登记需要准备什么材料',
  '如何填写紧急联系人',
  '住院登记的办理流程',
  '我要办理住院登记',
]

export const DEMO_USER = {
  name: '王*妮',
  phone: '18677445632',
  serial: 'NS1234567890987654321',
  version: 'V1.1.2',
}

export const VOICE_HINT =
  '您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。'

export const SCENE_BROADCAST = '您好~这里是智能入院登记。我将帮助您快捷录入入院登记信息。'

export const emptyFields = () => ({
  name: '',
  idNumber: '',
  phone: '',
  nationality: '',
  ethnicity: '',
  nativeRegion: [],
  residentRegion: [],
  addressDetail: '',
  employerName: '',
  employerAddress: '',
  marriage: '',
  occupation: '',
  emergencyContact: '',
  relationship: '',
})

export const FIELD_GROUPS = [
  {
    step: 1,
    title: '入院信息',
    fields: [
      // 姓名/身份证号按原型不带必填星，国籍/民族虽只读但带星。
      {
        key: 'name',
        label: '姓名',
        required: true,
        readonly: true,
        noStar: true,
      },
      {
        key: 'idNumber',
        label: '身份证号',
        required: true,
        readonly: true,
        noStar: true,
      },
      { key: 'phone', label: '联系电话', required: true },
      { key: 'nationality', label: '国籍', required: true, readonly: true },
      { key: 'ethnicity', label: '民族', required: true, readonly: true },
      { key: 'nativeRegion', label: '籍贯地址' },
      { key: 'residentRegion', label: '现住地址' },
      {
        key: 'addressDetail',
        label: '详细地址',
        placeholder: '请输入详细地址（最多50字）',
      },
    ],
  },
  {
    step: 2,
    title: '补充信息',
    fields: [
      {
        key: 'employerName',
        label: '工作单位名称',
        placeholder: '请输入工作单位名称（最多50字）',
      },
      {
        key: 'employerAddress',
        label: '工作单位地址',
        placeholder: '请输入详细工作单位地址（最多50字）',
      },
      { key: 'marriage', label: '婚姻状况', required: true },
      { key: 'occupation', label: '职业', required: true },
      { key: 'emergencyContact', label: '紧急联系人姓名', required: true },
      { key: 'relationship', label: '与患者关系', required: true },
    ],
  },
]

export const MARRIAGE_OPTIONS = ['未婚', '已婚', '离异', '丧偶']

export const OPTION_MAP = {
  occupation: ['职工', '农民', '退休', '无业', '学生', '其他'],
  relationship: [
    '配偶',
    '子女',
    '父母',
    '祖父母/外祖父母',
    '孙辈/外孙辈',
    '兄弟姐妹',
    '其他亲属',
    '非亲属',
  ],
}

// 抽取不确定时的兜底选项（12 号文档：选项必须由前端标准化组件承载）。
export const enumFieldOptions = (key) =>
  key === 'marriage' ? MARRIAGE_OPTIONS : OPTION_MAP[key] || []

// 表单对话的追问与重问固定话术（12-dialog-reply-flow-and-constraints.md 回复流程）。
export const FIELD_QUESTIONS = {
  phone: '请告诉我您的联系电话，我会先核对号码格式。',
  marriage: '您的婚姻状况是未婚、已婚、离异还是丧偶？',
  occupation: '请问您的职业是什么？',
  emergencyContact: '请告诉我您的紧急联系人姓名。',
  relationship: '您与该联系人的关系是什么？',
}

export const FIELD_REASK = {
  marriage: '请从未婚、已婚、离异、丧偶中选择一项。',
  occupation: '请从职工、农民、退休、无业、学生、其他中选择一项。',
  emergencyContact: '请告诉我紧急联系人的姓名。',
  relationship: '请从页面提供的关系选项中选择一项。',
}

export const COMPLETE_REPLY = '您的入院登记信息已填写完成，请核对后确认提交。'

export const fieldQuestion = (field) =>
  FIELD_QUESTIONS[field.key] || `请告诉我${field.label}，我会帮您核对。`

export const FIELD_LIMITS = {
  addressDetail: 50,
  employerName: 50,
  employerAddress: 50,
  emergencyContact: 40,
}

// 把 code/label/children 树转成 Element UI 级联控件需要的 value/label/leaf 树。
export function buildRegionOptions(regions) {
  return regions.map((region) => ({
    value: region.code,
    label: region.label,
    ...(region.children?.length
      ? { children: buildRegionOptions(region.children) }
      : { leaf: true }),
  }))
}
