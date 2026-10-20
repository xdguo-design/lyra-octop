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
        <el-button type="text" :disabled="submitting" @click="$emit('edit', group.step)"
          >编辑</el-button
        >
      </div>
      <div class="review-fields">
        <div v-for="field in group.fields" :key="field.key">
          <span>{{ field.label }}</span
          ><strong>{{ valueLabel(field.key) }}</strong>
        </div>
      </div>
    </section>
    <div class="application-actions">
      <el-button :disabled="submitting" @click="$emit('back')">返回修改</el-button>
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
export default {
  name: 'ReviewPanel',
  props: {
    application: { type: Object, required: true },
    groups: { type: Array, required: true },
    fields: { type: Object, required: true },
    valueLabel: { type: Function, required: true },
    submitting: { type: Boolean, default: false },
  },
}
</script>
