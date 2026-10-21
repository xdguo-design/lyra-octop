import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../../contracts/admission-fields.schema.json'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateContract = ajv.compile(schema)
let regions = []
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
    const node = children.find((item) => (item.code || item.value) === code)
    if (!node) return false
    children = node.children || []
  }
  return [2, 3].includes(codes.length) && children.length === 0
}

export function setRegions(value) {
  regions = Array.isArray(value) ? value : []
}

export function findRegionMismatch(text) {
  const cities = regions.flatMap((province) =>
    (province.children || []).map((city) => ({ ...city, parent: province }))
  )
  const areas = cities.flatMap((city) => {
    const descendants = (node) =>
      (node.children || []).flatMap((area) => [{ ...area, parentCity: city }, ...descendants(area)])
    return descendants(city)
  })
  const mentions = (nodes, start, end) =>
    nodes
      .flatMap((node) => {
        const found = []
        for (let index = text.indexOf(node.label, start); index >= 0 && index < end; ) {
          found.push({ node, index })
          index = text.indexOf(node.label, index + node.label.length)
        }
        return found
      })
      .sort(
        (left, right) =>
          left.index - right.index || right.node.label.length - left.node.label.length
      )

  for (const { node: province, index } of mentions(regions, 0, text.length)) {
    const provinceEnd = index + province.label.length
    const nextProvince = mentions(regions, provinceEnd, text.length)[0]?.index ?? text.length
    const cityMention = mentions(cities, provinceEnd, nextProvince)[0]
    if (!cityMention) continue
    const { node: city, index: cityAt } = cityMention
    if ((city.parent.code || city.parent.value) !== (province.code || province.value))
      return { parent: province, child: city, actualParent: city.parent }

    const cityEnd = cityAt + city.label.length
    const districtMention = mentions(areas, cityEnd, nextProvince)[0]
    if (
      districtMention &&
      (districtMention.node.parentCity.code || districtMention.node.parentCity.value) !==
        (city.code || city.value)
    )
      return {
        parent: city,
        child: districtMention.node,
        actualParent: districtMention.node.parentCity,
      }
  }
  return null
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
