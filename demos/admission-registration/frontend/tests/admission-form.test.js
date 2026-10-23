import { createLocalVue, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ElementUI from 'element-ui'
import AdmissionForm from '../src/components/AdmissionForm.vue'

const localVue = createLocalVue()
localVue.use(ElementUI)

describe('AdmissionForm standard options', () => {
  it('shows marriage and occupation as unselected standard radio options', () => {
    const wrapper = mount(AdmissionForm, {
      localVue,
      propsData: {
        step: 1,
        continuous: true,
        groups: [
          {
            title: '补充信息',
            fields: [
              { key: 'marriage', label: '婚姻状况', required: true },
              { key: 'occupation', label: '职业', required: true },
            ],
          },
        ],
        fields: { marriage: '', occupation: '' },
        regionOptions: [],
      },
    })

    const groups = wrapper.findAll('.marriage-options')
    expect(groups).toHaveLength(2)
    expect(groups.at(0).findAll('.el-radio-button')).toHaveLength(4)
    expect(groups.at(1).findAll('.el-radio-button').wrappers.map((option) => option.text())).toEqual([
      '职工',
      '农民',
      '退休',
      '无业',
      '学生',
      '其他',
    ])
    expect(wrapper.findAll('.el-radio-button.is-active')).toHaveLength(0)

    wrapper.destroy()
  })
})
