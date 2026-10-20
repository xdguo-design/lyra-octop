<template>
  <section class="panel result-panel">
    <div
      :class="[
        'result-icon',
        result && result.status === 'success' ? 'success' : 'pending',
      ]"
    >
      <i
        :class="
          result && result.status === 'success'
            ? 'el-icon-circle-check'
            : 'el-icon-warning-outline'
        "
      ></i>
    </div>
    <h2>{{ resultTitle }}</h2>
    <p>{{ resultMessage }}</p>
    <div v-if="result && result.receiptId" class="receipt">
      模拟回执号 <strong>{{ result.receiptId }}</strong>
    </div>
    <el-button
      v-if="result && result.status === 'unknown'"
      class="primary-action"
      :loading="checkingResult"
      @click="$emit('check')"
      >查询原登记结果</el-button
    >
    <el-button
      v-if="result && result.status === 'failed'"
      class="primary-action"
      @click="$emit('retry')"
      >返回表单并重试</el-button
    >
    <el-button class="secondary-action" @click="$emit('finish')">{{
      result && result.status === "success"
        ? "完成并返回首页"
        : "返回首页（清除本机显示）"
    }}</el-button>
  </section>
</template>

<script>
export default {
  name: "ResultPanel",
  props: {
    result: { type: Object, default: null },
    checkingResult: { type: Boolean, default: false },
  },
  computed: {
    resultTitle() {
      if (!this.result) return "登记结果待确认";
      return (
        {
          success: "模拟登记完成",
          failed: "模拟登记未完成",
          already_registered: "发现已有登记记录",
          unknown: "登记结果待确认",
        }[this.result.status] || "登记结果待确认"
      );
    },
    resultMessage() {
      if (!this.result) return "暂时无法确认服务端结果。请勿重复发起新的登记。";
      return (
        {
          // 场景 23/24 固定话术（12 号文档回复流程），演示免责说明保留在后半句。
          success:
            "您的入院登记已提交成功，请按页面提示继续办理后续入院手续。本次仅为演示，未向医院提交任何信息。",
          failed:
            "入院登记暂未提交成功，请重试或联系现场工作人员协助办理。已填写的信息仍保留在当前页面，可返回核对后重试。",
          already_registered: "模拟档案中已有登记记录，本次未创建新的登记。",
          unknown:
            "暂时无法确认服务端结果。请使用原请求编号查询，勿重复发起新的登记。",
        }[this.result.status] ||
        this.result.message ||
        "请联系现场工作人员。"
      );
    },
  },
};
</script>
