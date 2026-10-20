// 隐私遮罩：切后台(onHide)时立即覆盖页面内容，回到前台恢复
Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  methods: {
    noop() {}
  }
})
