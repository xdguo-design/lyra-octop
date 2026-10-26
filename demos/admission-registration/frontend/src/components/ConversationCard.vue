<template>
  <section class="conversation-card">
    <div class="conversation-title">您可以试着这样问我</div>
    <div class="conversation-prompts">
      <button
        v-for="(item, index) in shortcuts"
        :key="item"
        type="button"
        class="prompt-button"
        @click="$emit('select', index)"
      >
        {{ item }}
      </button>
    </div>
  </section>
</template>

<script>
export default {
  name: 'ConversationCard',
  props: {
    shortcuts: { type: Array, required: true },
  },
}
</script>
