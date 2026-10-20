/**
 * 云函数调用统一封装
 * 约定：所有云函数返回 { ok, code, ... }
 * 调用层失败不再一律算“网络不可用”，按 errCode 给出可诊断的提示
 */

// 常见 wx.cloud.callFunction 错误码 -> 人话提示（保持简短，toast 有长度限制）
const FAIL_HINT = {
  '-501000': '云环境未配置，请在 app.js 填写 env',
  '-501001': '云函数未部署，请上传 ledger/bill',
  '-501002': '云函数调用参数错误',
  '-501003': '云函数执行超时，请查看日志',
  '-504003': '云函数运行出错，请查看日志'
}

// 业务错误码 -> 人话提示
const CODE_HINT = {
  NETWORK: '网络不可用，已存入本地待同步',
  NO_COLLECTION: '缺少集合，请创建 ledgers/members/bills',
  FORBIDDEN: '无该账本权限',
  PARAM: '数据格式有误',
  NOT_FOUND: '记录不存在',
  LIMIT: '分类数量已达上限',
  DUP: '同名分类已存在',
  BUILTIN: '内置分类不可修改或删除',
  IN_USE: '该分类已有账单，不能删除',
  EXPIRED: '邀请码已过期，请让房主刷新',
  FULL: '该账本成员已满',
  LIMIT_LEDGER: '账本数量已达上限',
  LAST_LEDGER: '至少保留一个账本',
  UNAUTH: '未能获取用户身份',
  EMPTY_RESULT: '云函数返回为空',
  BAD_ACTION: '不支持的操作',
  INTERNAL: '服务开小差了，请查看云函数日志'
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
