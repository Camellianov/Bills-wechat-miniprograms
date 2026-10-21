const G = require('./guard')

const INVITE_TTL = 7 * 864e5 // 邀请码 7 天有效

exports.main = async (event) => {
  const e = event || {}
  try {
    switch (e.action) {
      case 'ping': return ping()
      case 'joinLedger': return await joinLedger(e)
      case 'listMembers': return await listMembers(e)
      case 'removeMember': return await removeMember(e)
      case 'leaveLedger': return await leaveLedger(e)
      case 'rotateInvite': return await rotateInvite(e)
      default: return { ok: false, code: 'BAD_ACTION' }
    }
  } catch (err) {
    console.error('[member]', e.action, err)
    return { ok: false, code: err.code || 'INTERNAL' } // 不回吐内部堆栈
  }
}

function ping() {
  return {
    ok: true,
    pong: true,
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
    time: new Date().toISOString()
  }
}

/** 当前账本切换：全部操作显式带 openid 条件 */
async function setCurrent(openid, ledgerId) {
  await G.db.collection('members')
    .where({ openid: openid, ledgerId: G._.neq(ledgerId), isCurrent: true })
    .update({ data: { isCurrent: false } })
  await G.db.collection('members')
    .where({ openid: openid, ledgerId: ledgerId, status: 'active' })
    .update({ data: { isCurrent: true } })
}

/** 用邀请码加入账本（幂等：已是成员则直接切到该账本） */
async function joinLedger(e) {
  const openid = G.getOpenid()
  const code = String(e.inviteCode || '').toUpperCase().trim()
  if (!/^[A-Z2-9]{6}$/.test(code)) throw G.err('PARAM', 'bad code')

  // 邀请码定位账本（走 inviteCode 索引，非全表扫描）
  const lr = await G.db.collection('ledgers').where({ inviteCode: code }).limit(1).get()
  if (!lr.data.length) throw G.err('NOT_FOUND', 'invalid code')
  const ledger = lr.data[0]

  if (!ledger.inviteCodeUpdatedAt ||
      Date.now() - new Date(ledger.inviteCodeUpdatedAt).getTime() > INVITE_TTL) {
    throw G.err('EXPIRED', 'code expired')
  }

  // 历史记录（含退出 / 被移除的）一律复用：同一人在同一账本永远只保留一条文档。
  // 此前退出后再加入是新建文档，一旦 (ledgerId, openid) 上有唯一约束就会撞重复键，
  // 异常被外层吞成 INTERNAL，前端表现为「无法加入」
  const mine = await G.db.collection('members')
    .where({ ledgerId: ledger._id, openid: openid })
    .limit(1)
    .get()

  const now = new Date()

  if (mine.data.length && mine.data[0].status === 'active') {
    await setCurrent(openid, ledger._id)
    return {
      ok: true, joined: false, alreadyMember: true,
      ledgerId: ledger._id, name: ledger.name, role: mine.data[0].role
    }
  }

  // 人数上限对「重新加入」同样生效：被移除后账本里可能已有新成员补位
  const cnt = await G.db.collection('members')
    .where({ ledgerId: ledger._id, status: 'active' })
    .count()
  if (cnt.total >= G.MAX_MEMBERS) throw G.err('FULL', 'ledger full')

  if (mine.data.length) {
    // 复用历史文档恢复成员身份，不新建
    await G.db.collection('members')
      .where({ _id: mine.data[0]._id, ledgerId: ledger._id, openid: openid })
      .update({ data: { status: 'active', isCurrent: true, joinedAt: now, updatedAt: now } })
    await setCurrent(openid, ledger._id)
    return { ok: true, joined: true, ledgerId: ledger._id, name: ledger.name, role: mine.data[0].role }
  }

  await G.db.collection('members').add({
    data: {
      _id: G.genId(),
      ledgerId: ledger._id,
      openid: openid,
      role: 'member',
      nickname: '',
      isCurrent: true,
      status: 'active',
      joinedAt: now,
      createdAt: now
    }
  })
  await setCurrent(openid, ledger._id)

  return { ok: true, joined: true, ledgerId: ledger._id, name: ledger.name, role: 'member' }
}

/** 成员列表：绝不返回他人 openid，只用序号 + 角色标识 */
async function listMembers(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  const me = await G.assertMember(ledgerId, openid)

  const res = await G.db.collection('members')
    .where({ ledgerId: ledgerId, status: 'active' })
    .orderBy('joinedAt', 'asc')
    .limit(G.MAX_LIMIT)
    .get()

  const members = res.data.map((m, i) => ({
    key: m._id,                    // 移除成员时回传这个，不接受 openid 入参
    isMe: m.openid === openid,
    role: m.role,
    nickname: m.nickname || '',
    memberNo: i + 1,
    joinedAt: m.joinedAt
  }))

  let inviteCode = ''
  let inviteUpdatedAt = null
  if (me.role === 'owner') { // 邀请码仅房主可见
    const lg = await G.getLedgerOrThrow(ledgerId)
    inviteCode = lg.inviteCode || ''
    inviteUpdatedAt = lg.inviteCodeUpdatedAt || null
  }

  return { ok: true, role: me.role, count: members.length, max: G.MAX_MEMBERS, inviteCode: inviteCode, inviteUpdatedAt: inviteUpdatedAt, members: members }
}

/** 移除成员：房主专属，不能移除自己、不能移除房主 */
async function removeMember(e) {
  const openid = G.getOpenid()
  const { ledgerId, memberKey } = e
  G.assertDocId(memberKey, 'memberKey')

  await G.assertOwner(ledgerId, openid)

  const t = await G.db.collection('members')
    .where({ _id: memberKey, ledgerId: ledgerId, status: 'active' })
    .limit(1)
    .get()
  if (!t.data.length) throw G.err('NOT_FOUND', 'member not found')
  if (t.data[0].openid === openid) throw G.err('PARAM', 'cannot remove self')
  if (t.data[0].role === 'owner') throw G.err('FORBIDDEN', 'cannot remove owner')

  const r = await G.db.collection('members')
    .where({ _id: memberKey, ledgerId: ledgerId, status: 'active' }) // 复合条件，杜绝跨账本越权
    .update({ data: { status: 'removed', isCurrent: false, updatedAt: new Date() } })
  if (!r.stats || r.stats.updated !== 1) throw G.err('INTERNAL', 'update failed')
  return { ok: true }
}

/** 退出账本：房主不可退出；退出后自动切到自己的其它账本 */
async function leaveLedger(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  const me = await G.assertMember(ledgerId, openid)
  if (me.role === 'owner') throw G.err('FORBIDDEN', 'owner cannot leave')

  const r = await G.db.collection('members')
    .where({ ledgerId: ledgerId, openid: openid, status: 'active' })
    .update({ data: { status: 'removed', isCurrent: false, updatedAt: new Date() } })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')

  const other = await G.db.collection('members')
    .where({ openid: openid, status: 'active' })
    .limit(1)
    .get()
  if (other.data.length) {
    await setCurrent(openid, other.data[0].ledgerId)
    return { ok: true, ledgerId: other.data[0].ledgerId }
  }
  return { ok: true, ledgerId: null } // 无任何账本，前端需重建默认账本
}

/** 刷新邀请码：房主专属，旧码立即失效 */
async function rotateInvite(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertOwner(ledgerId, openid)

  const code = G.genInviteCode()
  const r = await G.db.collection('ledgers').where({ _id: ledgerId }).update({
    data: { inviteCode: code, inviteCodeUpdatedAt: new Date(), updatedAt: new Date() }
  })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')
  return { ok: true, inviteCode: code }
}
