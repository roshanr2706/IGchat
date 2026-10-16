// IGchat relay bridge. Evaluated inside instagram.com by RelayFeed; returns 'live' | 'unavailable' | 'already'.
// Reads Instagram's own Relay store and pushes changed thread/message records to IGchat through a CDP binding.
// It never makes network requests and never modifies records; it only wraps store.notify (always calling the original).
(function install(bindingName) {
  'use strict';
  if (window.__igchatRelay) return 'already';
  var MESSAGE = 'SlideMessage';
  var THREAD = 'XFBIGDirectViewerThread';
  var MAILBOX = 'SlideMailbox';
  var MAX_DEPTH = 5;

  function isEnv(v) {
    return !!v && typeof v === 'object' && typeof v.getStore === 'function';
  }
  function tryRequire(name) {
    try {
      return typeof window.require === 'function' ? window.require(name) : null;
    } catch (e) {
      return null;
    }
  }
  function findEnv() {
    var factory = tryRequire('PolarisRelayEnvironmentFactory');
    if (factory && isEnv(factory.defaultEnvironment)) return factory.defaultEnvironment;
    var direct = tryRequire('PolarisRelayEnvironment');
    if (isEnv(direct)) return direct;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var keys = Object.keys(all[i]);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf('__reactContainer$') !== 0 && keys[j].indexOf('__reactFiber$') !== 0) continue;
        var start = all[i][keys[j]];
        if (start && start.current) start = start.current;
        var stack = [start];
        var visited = 0;
        while (stack.length && visited < 200000) {
          var f = stack.pop();
          visited++;
          if (!f) continue;
          var props = f.memoizedProps;
          if (props && isEnv(props.environment)) return props.environment;
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
        return null;
      }
    }
    return null;
  }

  var env = findEnv();
  if (!env) return 'unavailable';
  var store = env.getStore();
  var source = store.getSource();

  function baseKey(k) {
    var i = k.indexOf('(');
    return i === -1 ? k : k.slice(0, i);
  }
  function edgeCount(v) {
    return v && typeof v === 'object' && Array.isArray(v.edges) ? v.edges.length : -1;
  }
  // Inline linked records (`{__ref}` / `{__refs}`) into plain JSON shaped like a GraphQL response.
  function resolve(id, depth, path) {
    var rec = source.get(id);
    if (!rec || typeof rec !== 'object') return null;
    var out = {};
    for (var k in rec) {
      if (k === '__id') continue;
      var v = rec[k];
      var value;
      if (v && typeof v === 'object' && typeof v.__ref === 'string') {
        value = depth > 0 && path.indexOf(v.__ref) === -1 ? resolve(v.__ref, depth - 1, path.concat(id)) : null;
      } else if (v && typeof v === 'object' && Array.isArray(v.__refs)) {
        value =
          depth > 0
            ? v.__refs.map(function (r) {
                return path.indexOf(r) === -1 ? resolve(r, depth - 1, path.concat(id)) : null;
              })
            : [];
      } else {
        value = v;
      }
      var key = baseKey(k);
      // Several argument variants of one field (slide_messages(first:5) / (first:20)): keep the fullest.
      if (key in out && edgeCount(out[key]) >= edgeCount(value)) continue;
      out[key] = value;
    }
    return out;
  }

  var sigs = {};
  function scan(full) {
    var ids = source.getRecordIDs();
    var seen = {};
    var threads = [];
    var messages = [];
    var removed = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var rec = source.get(id);
      if (!rec || (rec.__typename !== MESSAGE && rec.__typename !== THREAD)) continue;
      seen[id] = true;
      var resolved = resolve(id, MAX_DEPTH, []);
      var sig;
      try {
        sig = JSON.stringify(resolved);
      } catch (e) {
        sig = String(Math.random());
      }
      if (full || sigs[id] !== sig) {
        sigs[id] = sig;
        if (rec.__typename === MESSAGE) messages.push(resolved);
        else threads.push(resolved);
      }
    }
    for (var old in sigs) {
      if (!seen[old]) {
        delete sigs[old];
        removed.push(old);
      }
    }
    return { threads: threads, messages: messages, removed: removed };
  }

  function viewer() {
    var pv = tryRequire('PolarisViewer');
    var data = pv && pv.data ? pv.data : null;
    var out = data ? { id: data.id, username: data.username, full_name: data.full_name, profile_pic_url: data.profile_pic_url } : {};
    var ids = source.getRecordIDs();
    for (var i = 0; i < ids.length && !out.fbid; i++) {
      var rec = source.get(ids[i]);
      if (rec && rec.__typename === THREAD && rec.viewer && rec.viewer.__ref) {
        var v = source.get(rec.viewer.__ref);
        if (v) {
          out.fbid = v.interop_messaging_user_fbid || null;
          if (!out.id) out.id = v.id;
          if (!out.profile_pic_url) out.profile_pic_url = v.profile_pic_url;
        }
      }
    }
    return out;
  }

  function inbox() {
    var ids = source.getRecordIDs();
    for (var i = 0; i < ids.length; i++) {
      var rec = source.get(ids[i]);
      if (!rec || rec.__typename !== MAILBOX) continue;
      for (var k in rec) {
        if (k.indexOf('threads_by_folder(') !== 0 || k.indexOf('INBOX') === -1 || !rec[k] || !rec[k].__ref) continue;
        var conn = source.get(rec[k].__ref);
        var pi = conn && conn.page_info && conn.page_info.__ref ? source.get(conn.page_info.__ref) : null;
        if (pi) return { endCursor: typeof pi.end_cursor === 'string' ? pi.end_cursor : null, hasMore: pi.has_next_page === true };
      }
    }
    return { endCursor: null, hasMore: false };
  }

  var timer = null;
  function flush() {
    timer = null;
    var delta = scan(false);
    if ((delta.threads.length || delta.messages.length || delta.removed.length) && typeof window[bindingName] === 'function') {
      window[bindingName](JSON.stringify(delta));
    }
  }
  var originalNotify = store.notify;
  store.notify = function () {
    var result = originalNotify.apply(this, arguments);
    if (!timer) timer = setTimeout(flush, 100);
    return result;
  };
  scan(true);
  window.__igchatRelay = {
    snapshot: function () {
      var d = scan(true);
      return { threads: d.threads, messages: d.messages, removed: [], viewer: viewer(), inbox: inbox() };
    }
  };
  return 'live';
})
