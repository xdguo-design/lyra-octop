import Vue from 'vue'
import Button from 'element-ui/lib/button'
import Cascader from 'element-ui/lib/cascader'
import Dialog from 'element-ui/lib/dialog'
import Input from 'element-ui/lib/input'
import Message from 'element-ui/lib/message'
import Option from 'element-ui/lib/option'
import RadioButton from 'element-ui/lib/radio-button'
import RadioGroup from 'element-ui/lib/radio-group'
import Select from 'element-ui/lib/select'
import 'element-ui/lib/theme-chalk/index.css'
import './style.css'
import App from './App.vue'

Vue.use(Button)
Vue.use(Cascader)
Vue.use(Dialog)
Vue.use(Input)
Vue.use(Option)
Vue.use(RadioButton)
Vue.use(RadioGroup)
Vue.use(Select)
Vue.prototype.$message = Message
Vue.config.productionTip = false

new Vue({ render: (h) => h(App) }).$mount('#app')
