/**
 * 辅助说明的收口
 * 界面上只留一个「!」符号，点击才展开完整说明，避免长段小字铺在页面上干扰阅读
 * 各页保留 onTipTap 作事件入口即可，提示样式与文案口径统一在这里
 */
function showTip(text) {
  if (!text) return
  wx.showModal({
    content: text,
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#6b93d6'
  })
}

module.exports = { showTip }
