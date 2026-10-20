const map = {}

function on(name, fn) {
  (map[name] || (map[name] = [])).push(fn)
}

function off(name, fn) {
  if (!map[name]) return
  map[name] = map[name].filter(f => f !== fn)
}

function emit(name, payload) {
  (map[name] || []).slice().forEach(f => {
    try { f(payload) } catch (e) { console.error('[bus]', name, e) }
  })
}

module.exports = { on, off, emit }
