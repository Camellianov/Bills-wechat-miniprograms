/**
 * 云函数调用统一封装
 * 约定：所有云函数返回 { ok, code, ... }
 * 提示一律面向使用者：只说「现在该做什么」，不暴露云环境、集合、云函数日志等开发者细节；
 * 开发期排查真实原因请到云开发控制台看云函数日志，或打印 res.errMsg
 */

// 常见 wx.cloud.callFunction 错误码 -> 人话提示（保持简短，toast 有长度限制）
const FAIL_HINT = {
  '-501000': '服务暂不可用，请稍后重试',
  '-501001': '服务暂不可用，请稍后重试',
  '-501002': '操作失败，请重试',
  '-501003': '请求超时，请重试',
  '-504003': '服务开小差了，请稍后重试'
}

// 业务错误码 -> 人话提示
const CODE_HINT = {
  NETWORK: '网络不可用，已存入本地待同步',
  NO_COLLECTION: '服务初始化中，请稍后重试',
  FORBIDDEN: '无该账本权限',
  PARAM: '数据格式有误',
  NOT_FOUND: '记录不存在',
  NO_DATA: '所选范围内没有账单可导出',
  TOO_MANY: '数据过多，请缩小日期范围',
  LIMIT: '分类数量已达上限',
  DUP: '同名分类已存在',
  BUILTIN: '内置分类不可修改或删除',
  IN_USE: '该分类已有账单，不能删除',
  EXPIRED: '邀请码已过期，请让房主刷新',
  FULL: '该账本成员已满',
  LIMIT_LEDGER: '账本数量已达上限',
  LAST_LEDGER: '至少保留一个账本',
  UNAUTH: '未能获取用户身份',
  EMPTY_RESULT: '服务开小差了，请稍后重试',
  BAD_ACTION: '不支持的操作',
  INTERNAL: '服务开小差了，请稍后重试'
}

function call(name, action, data) {
  const payload = Object.assign({ action: action }, data || {})
  return wx.cloud.callFunction({ name: name, data: payload })
    .then(res => (res && res.result) || { ok: false, code: 'EMPTY_RESULT' })
    .catch(e => {
      // 调用层异常：优先用 errCode 精确分类，不再一律归为网络问题
      const msg = String((e && e.errMsg) || '')
      const hit = Object.keys(FAIL_HINT).find(code => msg.indexOf(code) >= 0)
      return { ok: false, code: hit || 'NETWORK', errMsg: msg || 'callFunction failed' }
    })
}

/** 取一段可展示的文案（云使能错误码优先于调用层错误码） */
function errorText(res, fallback) {
  if (!res) return fallback || '操作失败'
  return CODE_HINT[res.code] || FAIL_HINT[res.code] || res.errMsg || fallback || '操作失败'
}

function toastError(res, fallback) {
  wx.showToast({ title: errorText(res, fallback || '操作失败'), icon: 'none' })
  return res
}

module.exports = { call, errorText, toastError }
