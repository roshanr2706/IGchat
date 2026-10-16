// IGchat relay bridge. Evaluated inside instagram.com by RelayFeed; returns 'live' | 'unavailable' | 'already' | 'error'.
// Reads Instagram's own Relay store and pushes changed thread/message records to IGchat through a CDP binding.
// It never makes network requests and never modifies records; it only wraps store.notify (always calling the original).
// Nothing in here may throw into the page: timer and notify paths are guarded.
(function install(bindingName, token) {
  'use strict';
  if (window.__igchatRelay) return 'already';
  var MESSAGE = 'SlideMessage';
  var THREAD = 'XFBIGDirectViewerThread';
  var MAILBOX = 'SlideMailbox';
  var MAX_DEPTH = 5;
  var MAX_PAYLOAD = 7500000; // under the host's 8,000,000 limit
  var HEAD = 160; // room for the payload keys and the dropped counter

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
    var seen = new WeakSet();
    var budget = 200000;
    // Try every React root candidate; each fiber is visited at most once across all roots.
    for (var i = 0; i < all.length && budget > 0; i++) {
      var keys = Object.keys(all[i]);
      for (var j = 0; j < keys.length && budget > 0; j++) {
        if (keys[j].indexOf('__reactContainer$') !== 0 && keys[j].indexOf('__reactFiber$') !== 0) continue;
        var start = all[i][keys[j]];
        if (start && start.current) start = start.current;
        var stack = [start];
        while (stack.length && budget > 0) {
          var f = stack.pop();
          if (!f || typeof f !== 'object' || seen.has(f)) continue;
          seen.add(f);
          budget--;
          var props = f.memoizedProps;
          if (props && isEnv(props.environment)) return props.environment;
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
      }
    }
    return null;
  }

  try {
    var env = findEnv();
    if (!env) return 'unavailable';
    var store = env.getStore();
    if (store.notify && store.notify.__igchatWrapped) return 'already';
    var source = store.getSource();

    var baseKey = function (k) {
      var i = k.indexOf('(');
      return i === -1 ? k : k.slice(0, i);
    };
    var edgeCount = function (v) {
      return v && typeof v === 'object' && Array.isArray(v.edges) ? v.edges.length : -1;
    };
    // Inline linked records (`{__ref}` / `{__refs}`) into plain JSON shaped like a GraphQL response.
    var resolve = function (id, depth, path) {
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
    };

    // sigs holds what the host has already received. It only changes through commit().
    var sigs = {};
    var dropped = 0;
    var active = true;
    var timer = null;

    var scan = function (full) {
      var ids = source.getRecordIDs();
      var seen = {};
      var changed = [];
      var removed = [];
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var rec = source.get(id);
        if (!rec || (rec.__typename !== MESSAGE && rec.__typename !== THREAD)) continue;
        seen[id] = true;
        var resolved = resolve(id, MAX_DEPTH, []);
        var json = null;
        try {
          json = JSON.stringify(resolved);
        } catch (e) {
          json = null;
        }
        var sig = json === null ? 'unserializable:' + id : json;
        if (full || sigs[id] !== sig) changed.push({ id: id, kind: rec.__typename === MESSAGE ? 'm' : 't', sig: sig, json: json, value: resolved });
      }
      for (var old in sigs) {
        if (!seen[old]) removed.push(old);
      }
      return { changed: changed, removed: removed };
    };
    var commit = function (entries, removedIds) {
      for (var i = 0; i < entries.length; i++) sigs[entries[i].id] = entries[i].sig;
      for (var j = 0; j < removedIds.length; j++) delete sigs[removedIds[j]];
    };

    var viewer = function () {
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
    };

    var inbox = function () {
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
    };

    // Splits a delta into payloads under MAX_PAYLOAD. A record is committed only after its payload was handed to the binding.
    var send = function (d) {
      var chunks = [];
      var cur = null;
      var open = function () {
        cur = { t: [], m: [], r: [], size: HEAD, entries: [], removed: [] };
        chunks.push(cur);
      };
      var add = function (key, str) {
        if (!cur || cur.size + str.length + 1 > MAX_PAYLOAD) open();
        cur[key].push(str);
        cur.size += str.length + 1;
        return cur;
      };
      var skipped = [];
      for (var i = 0; i < d.changed.length; i++) {
        var e = d.changed[i];
        if (e.json === null || e.json.length + HEAD + 1 > MAX_PAYLOAD) {
          dropped++;
          skipped.push(e);
          continue;
        }
        add(e.kind === 'm' ? 'm' : 't', e.json).entries.push(e);
      }
      for (var j = 0; j < d.removed.length; j++) add('r', JSON.stringify(d.removed[j])).removed.push(d.removed[j]);
      if (skipped.length) {
        commit(skipped, []); // deliberately skipped: counted once, not retried
        if (!chunks.length) open();
      }
      api.dropped = dropped;
      for (var c = 0; c < chunks.length; c++) {
        var ch = chunks[c];
        var payload = '{"threads":[' + ch.t.join(',') + '],"messages":[' + ch.m.join(',') + '],"removed":[' + ch.r.join(',') + '],"dropped":' + dropped + '}';
        window[bindingName](payload);
        commit(ch.entries, ch.removed);
      }
    };

    var flush = function () {
      timer = null;
      if (!active) return;
      try {
        var d = scan(false);
        if (!d.changed.length && !d.removed.length) return;
        if (typeof window[bindingName] !== 'function') return;
        send(d);
      } catch (e) {
        // Leave uncommitted records for the next notify.
      }
    };

    var api = {
      dropped: 0,
      token: token,
      snapshot: function () {
        var d = scan(true);
        var records = { threads: [], messages: [] };
        for (var i = 0; i < d.changed.length; i++) (d.changed[i].kind === 'm' ? records.messages : records.threads).push(d.changed[i].value);
        var snap = { threads: records.threads, messages: records.messages, removed: d.removed, viewer: viewer(), inbox: inbox() };
        // Measure here so oversized data never crosses CDP.
        var size = JSON.stringify(snap).length;
        return size > MAX_PAYLOAD ? { tooLarge: true } : snap;
      },
      // A no-op unless the token matches, so a stale install can never remove a newer bridge.
      uninstall: function (t) {
        if (t !== token) return;
        active = false;
        if (timer) clearTimeout(timer);
        timer = null;
        if (store.notify === wrapper) store.notify = originalNotify;
        if (window.__igchatRelay === api) delete window.__igchatRelay;
      }
    };

    var originalNotify = store.notify;
    var wrapper = function () {
      var result = originalNotify.apply(this, arguments);
      try {
        if (active && !timer) timer = setTimeout(flush, 100);
      } catch (e) {
        // never throw into the page
      }
      return result;
    };
    wrapper.__igchatWrapped = true;

    // Everything that can fail runs before the store is touched.
    var first = scan(true);
    commit(first.changed, first.removed);
    try {
      store.notify = wrapper;
      window.__igchatRelay = api;
    } catch (e) {
      store.notify = originalNotify;
      delete window.__igchatRelay;
      return 'error';
    }
    return 'live';
  } catch (e) {
    return 'error';
  }
})
