import { afterEach, describe, expect, it, vi } from 'vitest'
import { admissionApi } from '../src/api/admission.js'

afterEach(() => vi.unstubAllGlobals())

const tree = {
  mock: false,
  items: [
    {
      value: '110000',
      label: '北京市',
      leaf: false,
      children: [{ value: '110101', label: '东城区', leaf: true }],
    },
    {
      value: '130000',
      label: '河北省',
      leaf: false,
      children: [
        {
          value: '130100',
          label: '石家庄市',
          leaf: false,
          children: [{ value: '130102', label: '长安区', leaf: true }],
        },
      ],
    },
  ],
}

describe('admissionApi.regions', () => {
  it('omits the children key on leaves so the cascader treats districts as selectable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(tree), { status: 200 }))
    )
    const { items } = await admissionApi.regions()
    const dongcheng = items.find((item) => item.label === '北京市').children[0]
    expect(dongcheng.label).toBe('东城区')
    // Element UI ignores the leaf flag and expands any node carrying an empty
    // children array, which used to make the third level unselectable.
    expect(dongcheng).not.toHaveProperty('children')
    const changan = items.find((item) => item.label === '河北省').children[0].children[0]
    expect(changan.label).toBe('长安区')
    expect(changan).not.toHaveProperty('children')
  })
})
