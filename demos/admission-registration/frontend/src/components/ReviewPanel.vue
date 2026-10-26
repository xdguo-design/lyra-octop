<template>
  <section class="panel review-panel" aria-labelledby="review-title">
    <div class="application-heading">
      <div>
        <span class="step-eyebrow">入院登记 · 最后确认</span>
        <h1 id="review-title">请核对登记信息</h1>
        <p>确认后将提交本次模拟登记。信息有误可返回修改。</p>
      </div>
      <span class="mock-tag">演示数据</span>
    </div>
    <section class="review-application" aria-label="已选入院申请单">
      <h2>入院申请单</h2>
      <div class="application-details">
        <div>
          <span>申请单号</span><strong>{{ application.id }}</strong>
        </div>
        <div>
          <span>入院科室</span><strong>{{ application.department }}</strong>
        </div>
        <div>
          <span>计划入院时间</span><strong>{{ application.plannedAdmissionAt }}</strong>
        </div>
        <div>
          <span>诊断</span><strong>{{ application.diagnosis || '未提供' }}</strong>
        </div>
      </div>
    </section>
    <section v-for="group in groups" :key="group.step" class="review-group">
      <div class="review-group-heading">
        <h2>{{ group.title }}</h2>
        <el-button type="text" :disabled="submitting" @click="toggleEdit(group.step)"
          ><i class="el-icon-edit" aria-hidden="true"></i>
          {{ editingGroup === group.step ? '完成修改' : '编辑' }}</el-button
        >
      </div>
      <div class="review-fields">
        <div v-for="field in group.fields" :key="field.key">
          <span>{{ field.label }}</span>
          <template v-if="editingGroup === group.step && !field.readonly">
            <el-cascader
              v-if="field.key === 'nativeRegion' || field.key === 'residentRegion'"
              :value="fields[field.key]"
              :options="regionOptions"
              :props="regionProps"
              clearable
              :placeholder="'请选择' + field.label"
              :aria-label="'编辑' + field.label"
              @change="updateField(field.key, $event)"
            />
            <el-select
              v-else-if="optionMap[field.key] || field.key === 'marriage'"
              :value="fields[field.key]"
              clearable
              :placeholder="'请选择' + field.label"
              :aria-label="'编辑' + field.label"
              @change="updateField(field.key, $event)"
            >
              <el-option
                v-for="option in optionsFor(field.key)"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
            <div v-else-if="field.key === 'phone'" class="review-phone-editor">
              <button
                type="button"
                class="phone-display keypad-trigger"
                :class="{ 'phone-display--empty': !fields.phone }"
                :aria-label="'编辑' + field.label"
                @click="toggleKeypad($event)"
              >
                {{
                  fields.phone
                    ? keypadVisible
                      ? fields.phone
                      : valueLabel(field.key)
                    : '请输入联系电话'
                }}
              </button>
              <KeypadDialog
                :visible.sync="keypadVisible"
                :value="fields.phone"
                :anchor="keypadAnchor"
                @input="updateField('phone', $event)"
              />
            </div>
            <el-input
              v-else
              :value="fields[field.key]"
              :type="
                field.key === 'addressDetail' || field.key === 'employerAddress'
                  ? 'textarea'
                  : 'text'
              "
              :rows="field.key === 'addressDetail' ? 3 : 2"
              :maxlength="limitMap[field.key]"
              :placeholder="field.placeholder || '请输入' + field.label"
              :aria-label="'编辑' + field.label"
              @input="updateField(field.key, $event)"
            />
            <small v-if="fieldErrors[field.key]" class="field-error" role="alert">
              {{ fieldErrors[field.key] }}
            </small>
          </template>
          <strong v-else>{{ valueLabel(field.key) }}</strong>
        </div>
      </div>
    </section>
    <div class="application-actions">
      <el-button
        class="primary-action review-submit"
        type="primary"
        :loading="submitting"
        @click="$emit('submit')"
        >确认并提交入院登记</el-button
      >
    </div>
  </section>
</template>

<script>
import { FIELD_LIMITS, MARRIAGE_OPTIONS, OPTION_MAP } from '../model/formConfig.js'
import KeypadDialog from './KeypadDialog.vue'

const REGION_PROPS = { value: 'value', label: 'label', children: 'children', emitPath: true }

export default {
  name: 'ReviewPanel',
  components: { KeypadDialog },
  props: {
    application: { type: Object, required: true },
    groups: { type: Array, required: true },
    fields: { type: Object, required: true },
    fieldErrors: { type: Object, default: () => ({}) },
    regionOptions: { type: Array, default: () => [] },
    valueLabel: { type: Function, required: true },
    submitting: { type: Boolean, default: false },
  },
  data() {
    return {
      editingGroup: 0,
      keypadVisible: false,
      keypadAnchor: null,
      marriageOptions: MARRIAGE_OPTIONS,
      optionMap: OPTION_MAP,
      limitMap: FIELD_LIMITS,
      regionProps: REGION_PROPS,
    }
  },
  methods: {
    optionsFor(key) {
      return key === 'marriage' ? this.marriageOptions : this.optionMap[key] || []
    },
    toggleEdit(step) {
      if (this.editingGroup === step) {
        this.editingGroup = 0
        this.$emit('save-edits')
      } else this.editingGroup = step
    },
    updateField(key, value) {
      this.$set(this.fields, key, value)
      this.$emit('change', key)
    },
    toggleKeypad(event) {
      this.keypadAnchor = event?.currentTarget || null
      this.keypadVisible = !this.keypadVisible
    },
  },
}
</script>
