// ─────────────────────────────────────────────
//  ZeroJS Runtime  —  v0.0f
//  Ported from C# ZeroStrings / ZeroArray / ZeroParse
//  Exported as an ES module for Bun
// ─────────────────────────────────────────────

// ── String prototype extensions  (C# ZeroStrings) ──

String.prototype.after = function (a) {
  const i = this.indexOf(a);
  return i > -1 ? this.substring(i + a.length) : "";
};

String.prototype.before = function (b) {
  const i = this.indexOf(b);
  return i > -1 ? this.substring(0, i) : "";
};

String.prototype.zreplace = function (a, b) {
  return this.split(a).join(b);
};

String.prototype.toZero = function () {
  return new Zero([...this], "zero");
};

// ── Global stores  (plain string keys — no hashing) ──

const _storage = new Map();
const _stack   = new Map();

// ── Proxy handler — makes zero["key"] work ──

const ZeroProxyHandler = {
  get(target, prop, receiver) {
    if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);

    const n = Number(prop);
    if (Number.isInteger(n) && String(n) === prop)
      return target._list.get(n);

    if (Object.prototype.hasOwnProperty.call(target, prop))
      return Reflect.get(target, prop, receiver);

    if (_storage.has(prop))                         return _storage.get(prop);
    if (_storage.has(target._name + "." + prop))    return _storage.get(target._name + "." + prop);

    return Reflect.get(target, prop, receiver);
  },

  set(target, prop, value) {
    const n = Number(prop);
    if (Number.isInteger(n) && String(n) === prop) {
      target._list.set(n, value);
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(target, prop))
      return Reflect.set(target, prop, value);

    _storage.set(target._name + "." + prop, value);
    return true;
  },
};

// ── Zero class  (extends Array — main node type) ──

class Zero extends Array {

  constructor(stackOrName = "zero", name = "zero", isSilence = false) {
    super();

    this._list      = new Map();
    this._index     = 0;
    this._name      = name;
    this._isSilence = isSilence;

    this.isArray   = false;
    this.isModule  = false;
    this.isLoader  = false;
    this.isIndexer = false;
    this.isObject  = false;

    let _self;
    this._reloading = (s) => s;
    this.getter     = function(stack) { return _self._defaultGetter(stack); };
    this.setter     = function(stack) { return _self._defaultSetter(stack); };
    this.indexer_fn = function(n, code) { return _self._defaultIndexer(n, code); };

    if (Array.isArray(stackOrName)) {
      for (const s of stackOrName) this.add(String(s));
      this._index = 0;
    } else if (typeof stackOrName === "string" && stackOrName !== name) {
      this._name = stackOrName;
    }

    const proxy = new Proxy(this, ZeroProxyHandler);
    _self = proxy;
    _storage.set(this._name, proxy);
    return proxy;
  }

  static get storage() { return _storage; }
  static get stack()   { return _stack;   }
  static reset() { _storage.clear(); _stack.clear(); }

  // ── Array-like interface ──

  get count() { return this._list.size; }

  add(item) { this._list.set(this._list.size, this._reloading(item)); }

  at_idx(i) { return this._list.get(i); }

  get first() {
    this._index = 0;
    const v = this._list.get(0);
    return v !== undefined ? String(v) : null;
  }
  set first(v) { this._index = 0; this._list.set(0, v); }

  get next() {
    this._index++;
    const v = this._list.get(this._index);
    return v !== undefined ? String(v) : null;
  }
  set next(v) { this._index++; this._list.set(this._index, v); }

  get last() {
    this._index = this._list.size - 1;
    const v = this._list.get(this._index);
    return v !== undefined ? String(v) : null;
  }
  set last(v) { this._index = this._list.size - 1; this._list.set(this._index, v); }

  get previous() {
    this._index--;
    const v = this._list.get(this._index);
    return v !== undefined ? String(v) : null;
  }
  set previous(v) {
    this._index--;
    if (this._list.has(this._index)) this._list.set(this._index, v);
  }

  get zslice() {
    const vals = [...this._list.entries()]
      .filter(([k]) => k > this._index).map(([, v]) => v);
    return new Zero(vals.map(String), "zero");
  }

  take(n) {
    const vals = [...this._list.entries()]
      .filter(([k]) => k > this._index).map(([, v]) => v).slice(0, n);
    return new Zero(vals.map(String), "zero");
  }

  join(between = "") {
    const sb = [];
    let item = this.first;
    while (item !== null && item !== undefined) { sb.push(item); item = this.next; }
    item = this.first;
    item = this.previous;
    while (item !== null && item !== undefined) { sb.push(item); item = this.previous; }
    return sb.join(between);
  }

  setLoading(code) { this._reloading = this.eval(code); }

  // ── Eval ──

  eval(code) {
    return (stack = null) => evalLoad(code, this, stack);
  }

  // ── Property access helpers ──

  hasOwnProperty(property) {
    return _storage.has(this._name + "." + property);
  }

  get members() { return _storage.values(); }

  // ── Getter / Setter / Value ──

  get value()  { return this.getter(""); }
  set value(v) { this.setter(v); }

  _defaultGetter(stack) { return this.join(stack); }

  _defaultSetter(stack) {
    if (this.hasOwnProperty("value"))
      return this["value"].getter(stack);
    return null;
  }

  _defaultIndexer(name, code) {
    _storage.set(this._name + "." + name, this.eval(code));
    return "";
  }

  toString() { return this.getter(""); }

  clearStack() { _stack.clear(); }
}

// ── Z(name) — direct storage lookup by full path ──

function Z(name) {
  return _storage.get(name);
}

// ── evalLoad ──

let zeroRoot;

function evalLoad(code, that = null, stack = null) {
  const fn = new Function(
    "that", "zero", "stack", "Zero", "evalLoad", "Z",
    code
  );
  return fn(that, zeroRoot, stack, Zero, evalLoad, Z);
}

// ── Parser  (ZeroParse.cs → JavaScript) ──

function newParam() {
  return { isArray: false, plus: 0, minus: -1 };
}

function setParam(target, src) {
  target.isArray = src.isArray;
  target.plus    = src.plus;
  target.minus   = src.minus;
}

// Script(script, objectTypes)
//
// objectTypes — Set of type names (e.g. "text", "rect", "circle", "image") that
// should behave as auto-indexed objects. When one of these names is followed by
// a ( block, the parser automatically creates a new indexed instance (equivalent
// to the old `+(` syntax) and the matching `)` restores the parent scope
// (equivalent to the old `)**`). This lets you write:
//
//   text (
//     content "Hello"
//   )
//
// instead of:
//
//   text +(
//     content "Hello"
//   )**
//
function Script(script, objectTypes = new Set()) {
  const sys = {
    text:      script,
    chr:       0,
    name:      "",
    root:      "zero",
    node:      "zero",
    exist:     { zero: newParam() },
    rootStack: [],
    isArray:   false,
    here:      () => sys.text[sys.chr],
    stop:      () => sys.text.length,
    until:     (a, b) => {
      let level = 0, result = "";
      for (sys.chr++; sys.chr < sys.stop(); sys.chr++) {
        const ch = sys.here();
        if (ch === b) { if (level <= 0) return result; else level--; }
        result += ch;
        if (a !== "" && ch === a) level++;
      }
      return "";
    },
    // Pending info set by parsing[""] when an object type is detected.
    // Consumed by parsing["("] to record scope cleanup for parsing[")"].
    pendingObjectInfo: null,
    // Stack of { trigger, target } entries — one per open object-type scope.
    // trigger: rootStack.length expected after ) fires (then we do extra cleanup)
    // target:  rootStack.length to restore to (removes auto-+ pushes)
    objectScopeStack: [],
  };

  const parsing = {};

  parsing["#"]       = () => { sys.until("", "\n"); return ""; };
  parsing["module"]  = () => "";
  parsing["loader"]  = () => "";
  parsing["indexer"] = () => "";
  parsing["object"]  = () => "";
  parsing["silence"] = () => "";

  parsing[""] = (stack) => {
    if (!sys.name && !stack) return "";
    if (sys.name && parsing[sys.name]) return parsing[sys.name](stack);
    if (stack === "") return "";
    sys.name = stack;
    const fullNode = sys.node + "." + sys.name;

    // ── Object type: auto-create indexed instance (replaces `+( )** ` syntax) ──
    if (objectTypes.has(sys.name)) {
      const lines = [];
      // Create the container node once
      if (!sys.exist[fullNode]) {
        sys.exist[fullNode] = newParam();
        lines.push(`new Zero("${fullNode}", false);`);
      }
      sys.node = fullNode;
      // Mark container as an object type
      lines.push(`Z("${fullNode}").isObject = true;`);
      // Record how many items auto-+ will push (1 if already in array, 2 if not)
      const prePushDepth  = sys.rootStack.length;
      const autoPushCount = sys.isArray ? 1 : 2;
      // Auto-+ logic (mirrors parsing["+"])
      if (!sys.isArray) sys.rootStack.push(sys.root);
      sys.isArray = true;
      sys.rootStack.push(sys.node);
      sys.root = sys.node;
      const idx = sys.exist[sys.node].plus;
      sys.exist[sys.node].plus++;
      sys.node += "|" + idx;
      sys.exist[sys.node] = newParam();
      lines.push(`Z("${sys.root}")._list.set(${idx}, new Zero("${sys.node}", false));`);
      // After the upcoming (, rootStack grows by 1 more; the object's ) will pop
      // that 1, leaving rootStack.length === prePushDepth + autoPushCount (= trigger).
      // We then pop autoPushCount more items to reach prePushDepth (= target).
      sys.pendingObjectInfo = {
        trigger: prePushDepth + autoPushCount,
        target:  prePushDepth,
      };
      return lines.join("\n");
    }

    if (sys.exist[fullNode] || parsing[sys.name]) {
      sys.node = fullNode;
      return "";
    }
    sys.node = fullNode;
    sys.exist[sys.node] = newParam();
    return `new Zero("${sys.node}", false);`;
  };

  parsing["("] = () => {
    // If the preceding token was an object type, record the scope info so
    // parsing[")"] can clean up the extra auto-+ pushes.
    if (sys.pendingObjectInfo) {
      sys.objectScopeStack.push(sys.pendingObjectInfo);
      sys.pendingObjectInfo = null;
    }
    sys.rootStack.push(sys.root);
    sys.root = sys.node;
    setParam(sys, newParam());
    return "";
  };

  parsing[")"] = () => {
    sys.root = sys.rootStack.pop();
    sys.node = sys.root;
    setParam(sys, sys.exist[sys.node] ?? newParam());
    // Check if this ) closes an auto-indexed object scope.
    // The trigger value is the rootStack.length we expect to see here.
    if (sys.objectScopeStack.length > 0) {
      const info = sys.objectScopeStack[sys.objectScopeStack.length - 1];
      if (sys.rootStack.length === info.trigger) {
        sys.objectScopeStack.pop();
        // Pop the extra frames that auto-+ pushed (equivalent to **)
        while (sys.rootStack.length > info.target) {
          sys.root = sys.rootStack.pop();
          sys.node = sys.root;
          setParam(sys, sys.exist[sys.root] ?? newParam());
        }
      }
    }
    return "";
  };

  parsing[","] = () => {
    sys.node = sys.root;
    setParam(sys, sys.exist[sys.node]);
    sys.name = "";
    return "";
  };

  parsing["+"] = () => {
    if (!sys.isArray) sys.rootStack.push(sys.root);
    sys.isArray = true;
    sys.rootStack.push(sys.node);
    sys.root = sys.node;
    const idx = sys.exist[sys.node].plus;
    sys.exist[sys.node].plus++;
    sys.node += "|" + idx;
    sys.exist[sys.node] = newParam();
    return `Z("${sys.root}")._list.set(${idx}, new Zero("${sys.node}", false));`;
  };

  parsing["-"] = () => {
    if (!sys.isArray) sys.rootStack.push(sys.root);
    sys.isArray = true;
    sys.rootStack.push(sys.node);
    sys.root = sys.node;
    const idx = sys.exist[sys.node].minus;
    sys.exist[sys.node].minus--;
    sys.node += "|" + idx;
    sys.exist[sys.node] = newParam();
    return `Z("${sys.root}")._list.set(${idx}, new Zero("${sys.node}", false));`;
  };

  parsing["*"] = () => {
    sys.root = sys.rootStack.pop();
    sys.node = sys.root;
    setParam(sys, sys.exist[sys.node]);
    return "";
  };

  parsing["\n"] = () => {
    if (sys.isArray) { sys.root = sys.rootStack.pop(); sys.node = sys.root; }
    return "";
  };

  parsing["["] = () => {
    const name = sys.until("", "]");
    sys.until("", "{");
    const code = sys.until("{", "}")
      .replace(/\\/g, "\\\\").replace(/\n/g, "").replace(/\r/g, "")
      .replace(/\t/g, "").replace(/"/g, '\\"');
    return `Z("${sys.node}").indexer_fn("${name}","${code}");`;
  };

  parsing["="] = () => {
    sys.name = "value";
    sys.node += "." + sys.name;
    sys.exist[sys.node] = {};
    return `new Zero("${sys.node}", false);`;
  };

  parsing["{"] = () => {
    const code = sys.until("{", "}")
      .replace(/\\/g, "\\\\").replace(/\n/g, "").replace(/\r/g, "")
      .replace(/\t/g, "").replace(/"/g, '\\"');
    if (sys.name === "value") {
      return `_setter = (stack) => evalLoad("return this._name;", Z("${sys.node}"), stack); ` +
             `Z("${sys.node}").setter = _setter;`;
    }
    return `_getter = (stack) => evalLoad("${code}", Z("${sys.node}"), stack); ` +
           `Z("${sys.node}").getter = _getter;`;
  };

  parsing["}"] = () => "";

  parsing["'"] = () => {
    const data = sys.until("", "'")
      .replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
    return `Z("${sys.node}").add("${data}");`;
  };

  parsing['"'] = () => {
    const data = sys.until("", '"')
      .replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
    return `Z("${sys.node}").add("${data}");`;
  };

  const BREAKERS = `(),{}[]+=-*'"# \t\r\n`;
  const result = [
    "let _getter;",
    "let _setter;",
    `new Zero("stack", "stack");`,
  ];

  let stk = "";
  for (sys.chr = 0; sys.chr < sys.text.length; sys.chr++) {
    const c = sys.here();
    if (BREAKERS.includes(c)) {
      if (c === "\n") parsing["\n"](stk);
      const chr = c.trim();
      if (stk.length > 0) {
        const line = parsing[""](stk);
        if (line) result.push(line);
      }
      stk = "";
      const lin = (parsing[chr] ?? (() => ""))(stk);
      if (lin) result.push(lin);
    } else {
      stk += c;
    }
  }

  return result.join("\n") + "\nreturn zero;";
}

// ── parseScript(text, objectTypes) ──────────────────────────────────────────
//
// Parse a ZeroJS DSL string and return the root zero node.
// objectTypes — Set of type names that use the simplified object syntax
//               (bare `name ( ... )` instead of `name +( ... )** `).

function parseScript(text, objectTypes = new Set()) {
  Zero.reset();
  zeroRoot = new Zero("zero", "zero");
  const generatedCode = Script(text, objectTypes);
  evalLoad(generatedCode);
  return zeroRoot;
}

export { Zero, Z, Script, evalLoad, parseScript };
