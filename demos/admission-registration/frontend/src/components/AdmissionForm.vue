<template>
  <div class="form-stage">
    <div class="scene-bubble">身份已核验，请核对并填写住院登记信息</div>
    <section class="panel form-panel">
      <div class="form-inner">
        <p class="form-required-hint">
          <span class="required-star">*</span> 为必填项，身份档案信息已自动带入
        </p>
        <section v-for="group in visibleGroups" :key="group.title" class="form-group">
          <h2 class="form-title">
            {{ group.title }} <small v-if="!continuous">{{ step }}/{{ groups.length }}</small>
          </h2>
          <div
            v-for="field in group.fields"
            :key="field.key"
            :class="['field-row', { 'field-row--invalid': fieldErrors[field.key] }]"
          >
            <label :for="field.key" class="field-label">
              {{ field.label
              }}<span v-if="field.required && !field.readonly" class="required-star">*</span>
            </label>
            <div
              v-if="field.readonly"
              :class="[
                'readonly-value',
                { 'readonly-value--accent': field.key === 'name' || field.key === 'idNumber' },
              ]"
              :aria-label="field.label + '，只读'"
            >
              <span>{{
                field.key === 'name'
                  ? maskName(fields.name)
                  : field.key === 'idNumber'
                  ? maskId(fields.idNumber)
                  : fields[field.key]
              }}</span>
              <small>身份档案</small>
            </div>
            <div
              v-else-if="field.key === 'nativeRegion' || field.key === 'residentRegion'"
              class="control-wrap"
            >
              <el-cascader
                :id="field.key"
                v-model="fields[field.key]"
                :options="regionOptions"
                :props="regionProps"
                clearable
                :placeholder="'请选择' + field.label"
                @change="$emit('change', field.key)"
              />
            </div>
            <div
              v-else-if="field.key === 'marriage' || field.key === 'occupation'"
              class="control-wrap"
            >
              <el-radio-group
                :id="field.key"
                v-model="fields[field.key]"
                class="marriage-options"
                :class="{ 'occupation-options': field.key === 'occupation' }"
                @change="$emit('change', field.key)"
              >
                <el-radio-button
                  v-for="option in field.key === 'marriage'
                    ? marriageOptions
                    : optionMap.occupation"
                  :key="option"
                  :label="option"
                  >{{ option }}</el-radio-button
                >
              </el-radio-group>
            </div>
            <div v-else-if="field.key === 'relationship'" class="control-wrap">
              <el-select
                :id="field.key"
                v-model="fields[field.key]"
                clearable
                :placeholder="'请选择' + field.label"
                @change="$emit('change', field.key)"
              >
                <el-option
                  v-for="option in optionMap[field.key]"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
            </div>
            <div v-else-if="field.key === 'phone'" class="control-wrap input-wrap">
              <button
                :id="field.key"
                type="button"
                class="phone-display keypad-trigger"
                :class="{ 'phone-display--empty': !fields.phone }"
                aria-label="联系电话，点击打开数字键盘"
                @click="toggleKeypad"
              >
                {{
                  fields.phone
                    ? keypadVisible
                      ? fields.phone
                      : maskPhone(fields.phone)
                    : '请输入联系电话'
                }}
              </button>
              <KeypadDialog
                :visible.sync="keypadVisible"
                :value="fields.phone"
                :anchor="keypadAnchor"
                @input="onKeypadInput"
              />
              <span v-if="sources[field.key] === 'ai'" class="source-badge"
                ><i class="el-icon-magic-stick"></i> 语音候选 · 请核对</span
              >
            </div>
            <div v-else class="control-wrap input-wrap">
              <el-input
                :id="field.key"
                v-model="fields[field.key]"
                :type="
                  field.key === 'addressDetail' || field.key === 'employerAddress'
                    ? 'textarea'
                    : 'text'
                "
                :rows="2"
                :maxlength="limitMap[field.key]"
                :placeholder="field.placeholder || '请输入' + field.label"
                @input="$emit('change', field.key)"
              />
              <span v-if="sources[field.key] === 'ai'" class="source-badge"
                ><i class="el-icon-magic-stick"></i> 语音候选 · 请核对</span
              >
            </div>
            <p v-if="fieldErrors[field.key]" class="field-error" role="alert">
              {{ fieldErrors[field.key] }}
            </p>
          </div>
        </section>
        <el-button
          type="primary"
          class="confirm-submit"
          :loading="submitting"
          :disabled="submitting"
          @click="$emit('next')"
          >{{ continuous || isLast ? '核对登记信息' : '下一步：补充信息' }}</el-button
        >
      </div>
    </section>
    <div class="pager-actions" v-if="!continuous && step > 1">
      <el-button class="page-arrow" circle aria-label="上一页" @click="$emit('back')"
        ><i class="el-icon-back"></i
      ></el-button>
    </div>
  </div>
</template>

<script>
import { FIELD_LIMITS, MARRIAGE_OPTIONS, OPTION_MAP } from '../model/formConfig.js'
import KeypadDialog from './KeypadDialog.vue'
import { maskId, maskName, maskPhone } from '../utils/mask.js'

const REGION_PROPS = { value: 'value', label: 'label', children: 'children', emitPath: true }

export default {
  name: 'AdmissionForm',
  components: { KeypadDialog },
  props: {
    step: { type: Number, required: true },
    continuous: { type: Boolean, default: false },
    groups: { type: Array, required: true },
    fields: { type: Object, required: true },
    fieldErrors: { type: Object, default: () => ({}) },
    sources: { type: Object, default: () => ({}) },
    submitting: { type: Boolean, default: false },
    regionOptions: { type: Array, required: true },
  },
  data() {
    return {
      marriageOptions: MARRIAGE_OPTIONS,
      optionMap: OPTION_MAP,
      limitMap: FIELD_LIMITS,
      regionProps: REGION_PROPS,
      keypadVisible: false,
      keypadAnchor: null,
    }
  },
  computed: {
    group() {
      return this.groups[this.step - 1]
    },
    visibleGroups() {
      return this.continuous ? this.groups : [this.group]
    },
    isLast() {
      return this.step === this.groups.length
    },
  },
  watch: {
    keypadVisible(value, previous) {
      if (previous && !value) this.$emit('save-edits')
    },
  },
  methods: {
    maskName,
    maskId,
    maskPhone,
    toggleKeypad(event) {
      // 用 currentTarget 取触发按钮：按钮在 v-for 内，$refs 会变成数组。
      this.keypadAnchor = event?.currentTarget || null
      this.keypadVisible = !this.keypadVisible
    },
    onKeypadInput(value) {
      this.fields.phone = value
      this.$emit('change', 'phone', { deferPersistence: true })
    },
  },
}
</script>
