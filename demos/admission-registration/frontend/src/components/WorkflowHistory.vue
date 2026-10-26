<template>
  <section class="workflow-history" aria-label="办理过程记录">
    <template v-for="(entry, index) in entries">
      <article :key="`${index}-${entry.title}`">
        <h2>{{ entry.title }}</h2>
        <p v-if="entry.text">{{ maskText(entry.text) }}</p>
        <dl v-if="entry.fields.length">
          <div v-for="field in entry.fields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ maskText(field.value) || '未填写' }}</dd>
          </div>
        </dl>
      </article>
      <div
        v-if="entry.messages && entry.messages.length"
        :key="`${index}-messages`"
        class="workflow-history__messages"
      >
        <ConversationMessage
          v-for="(message, messageIndex) in entry.messages"
          :key="messageIndex"
          :message="message"
          :field-keywords="fieldKeywords"
          :required-progress="entry.requiredProgress"
          :disabled="voiceActive"
          @speak="$emit('speak-message', $event)"
        />
      </div>
    </template>
  </section>
</template>

<script>
import { maskText } from '../utils/mask.js'
import ConversationMessage from './ConversationMessage.vue'

export default {
  name: 'WorkflowHistory',
  components: { ConversationMessage },
  props: {
    entries: { type: Array, default: () => [] },
    fieldKeywords: { type: Array, default: () => [] },
    voiceActive: { type: Boolean, default: false },
  },
  methods: { maskText },
}
</script>
