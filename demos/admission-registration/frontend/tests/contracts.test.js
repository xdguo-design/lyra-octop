import { beforeEach, describe, expect, it } from 'vitest'
import { FIELD_REASK, buildRegionOptions, enumFieldOptions } from '../src/model/formConfig.js'
import { findRegionMismatch, setRegions, validateFields } from '../src/model/validation.js'

const fields = {
  name: '演示患者',
  idNumber: 'DEMO-ID-0001',
  phone: '13800138000',
  nationality: '中国',
  ethnicity: '汉族',
  nativeRegion: [],
  residentRegion: ['110000', '110105'],
  addressDetail: '',
  employerName: '',
  employerAddress: '',
  marriage: '未婚',
  occupation: '职工',
  emergencyContact: '王小明',
  relationship: '子女',
}

beforeEach(() => {
  setRegions([
    {
      value: '110000',
      label: '北京市',
      children: [{ value: '110105', label: '朝阳区' }],
    },
    {
      value: '210000',
      label: '辽宁省',
      children: [
        {
          value: '210100',
          label: '沈阳市',
          children: [
            { value: '210103', label: '沈河区' },
            { value: '210104', label: '大东区' },
          ],
        },
      ],
    },
    {
      value: '370000',
      label: '山东省',
      children: [
        { value: '370100', label: '济南市', children: [{ value: '370102', label: '历下区' }] },
      ],
    },
    { value: '810000', label: '香港特别行政区', children: [{ value: '810001', label: '中西区' }] },
  ])
})

describe('shared admission contract', () => {
  it('accepts the complete mock draft', () => expect(validateFields(fields)).toEqual({}))
  it('accepts Shenyang Shenhe district for AI and manual cascading selection', () => {
    expect(
      validateFields({
        ...fields,
        nativeRegion: ['210000', '210100', '210103'],
        residentRegion: ['210000', '210100', '210103'],
      })
    ).toEqual({})
  })
  it('accepts a real two-level Hong Kong district path', () => {
    expect(validateFields({ ...fields, residentRegion: ['810000', '810001'] })).toEqual({})
  })
  it('checks address conflicts against the runtime region tree', () => {
    const mismatch = findRegionMismatch('山东省沈阳市大东区')
    expect(mismatch).toMatchObject({
      child: { label: '沈阳市' },
      actualParent: { label: '辽宁省' },
    })
  })
  it('rejects a path that stops at a city with child districts', () => {
    expect(validateFields({ ...fields, residentRegion: ['210000', '210100'] })).toHaveProperty(
      'residentRegion'
    )
  })
  it('builds leaf options from the source tree without fake city levels', () => {
    expect(
      buildRegionOptions([
        {
          code: '810000',
          label: '香港特别行政区',
          children: [{ code: '810001', label: '中西区' }],
        },
      ])
    ).toEqual([
      {
        value: '810000',
        label: '香港特别行政区',
        children: [{ value: '810001', label: '中西区', leaf: true }],
      },
    ])
  })
  it('reports invalid mobile and unsupported region path', () => {
    expect(
      validateFields({
        ...fields,
        phone: '1380013800',
        residentRegion: ['110000', '210100', '210112'],
      })
    ).toMatchObject({
      phone: expect.any(String),
      residentRegion: expect.any(String),
    })
  })
  it('keeps re-ask wording in sync with the enum options', () => {
    // 重问话术会逐项念出选项，一旦和 OPTION_MAP 脱节（如文案写"离退休"、选项是"退休"），
    // 患者会照着一个不存在的选项回答。
    for (const key of ['marriage', 'occupation']) {
      const listed = FIELD_REASK[key]
        .replace(/^请从/, '')
        .replace(/中选择一项。$/, '')
        .split('、')
      expect(listed, key).toEqual(enumFieldOptions(key))
    }
    expect(FIELD_REASK.relationship).not.toContain('、')
  })
})
