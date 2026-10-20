import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../../contracts/admission-fields.schema.json'
import regions from '../../../contracts/regions.mock.json'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateContract = ajv.compile(schema)
const labels = {
  name: '请输入姓名',
  idNumber: '身份证信息缺失，请重新核验',
  phone: '请输入有效的11位手机号码',
  nationality: '国籍信息缺失，请重新核验',
  ethnicity: '民族信息缺失，请重新核验',
  addressDetail: '详细地址不能超过200个字符',
  employerName: '仅支持中英文、数字、空格、中点和括号',
  employerAddress: '仅支持中英文、数字、空格、中点和括号',
  marriage: '请选择婚姻状况',
  occupation: '请选择职业',
  emergencyContact: '请输入有效的紧急联系人姓名',
  relationship: '请选择与患者的关系',
}

function hasRegionPath(nodes, codes) {
  let children = nodes
  for (const code of codes) {
    const node = children.find((item) => item.code === code)
    if (!node) return false
    children = node.children || []
  }
  return [2, 3].includes(codes.length) && children.length === 0
}

export function validateFields(fields, keys = Object.keys(schema.properties)) {
  const errors = {}
  validateContract(fields)
  for (const issue of validateContract.errors || []) {
    const key = issue.instancePath.split('/')[1] || issue.params?.missingProperty || '_'
    if (keys.includes(key)) errors[key] = labels[key] || '此项格式不正确'
  }
  for (const key of ['nativeRegion', 'residentRegion']) {
    if (keys.includes(key) && fields[key]?.length && !hasRegionPath(regions, fields[key])) {
      errors[key] = '请选择有效的省、市、区组合'
    }
  }
  return errors
}

export { regions }
