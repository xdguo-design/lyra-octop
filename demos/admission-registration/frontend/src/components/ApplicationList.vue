<template>
  <section class="panel application-panel" aria-labelledby="application-title">
    <div class="application-heading">
      <div>
        <span class="step-eyebrow">入院登记 · 前置核验</span>
        <h1 id="application-title">本人入院申请单</h1>
        <p>请确认有效的入院申请单。没有申请单不能办理入院登记。</p>
      </div>
      <span class="mock-tag">演示数据</span>
    </div>
    <p v-if="loading" class="application-empty" role="status">正在查询本人申请单…</p>
    <p v-else-if="error" class="application-error" role="alert">{{ error }}</p>
    <p v-else-if="!items.length" class="application-empty">
      未查询到本人有效的入院申请单，请联系现场工作人员。
    </p>
    <article
      v-for="item in items"
      :key="item.id"
      class="application-card"
      :class="{ 'application-card--selected': item.id === selectedId }"
      :aria-label="`入院申请单 ${item.id}`"
    >
      <div class="application-card-top">
        <div>
          <span>申请单号</span><strong>{{ item.id }}</strong>
        </div>
        <span class="application-status">{{ item.status }}</span>
      </div>
      <div class="application-details">
        <div>
          <span>患者</span><strong>{{ item.patientName }}</strong>
        </div>
        <div>
          <span>入院科室</span><strong>{{ item.department }}</strong>
        </div>
        <div>
          <span>计划入院时间</span><strong>{{ item.plannedAdmissionAt }}</strong>
        </div>
        <div>
          <span>开单医生</span><strong>{{ item.doctor || '未提供' }}</strong>
        </div>
        <div>
          <span>住院类型</span><strong>{{ item.type || '未提供' }}</strong>
        </div>
        <div>
          <span>诊断</span><strong>{{ item.diagnosis || '未提供' }}</strong>
        </div>
        <div>
          <span>病区</span><strong>{{ item.ward || '未提供' }}</strong>
        </div>
        <div>
          <span>开单时间</span><strong>{{ item.orderedAt || '未提供' }}</strong>
        </div>
      </div>
      <el-button
        v-if="item.status === '有效'"
        class="application-select"
        :type="item.id === selectedId ? 'primary' : 'default'"
        @click="$emit('select', item.id)"
        >{{ item.id === selectedId ? '已选择此申请单' : '选择此申请单' }}</el-button
      >
    </article>
    <div class="application-actions">
      <el-button @click="$emit('back')">返回身份核验</el-button>
      <el-button
        class="primary-action application-continue"
        type="primary"
        :disabled="!selectedId || loading || !!error"
        :loading="selecting"
        @click="$emit('continue')"
        >确认申请单并继续</el-button
      >
    </div>
  </section>
</template>

<script>
export default {
  name: 'ApplicationList',
  props: {
    items: { type: Array, default: () => [] },
    selectedId: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    selecting: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
}
</script>
