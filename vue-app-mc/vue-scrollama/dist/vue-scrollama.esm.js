// DOM helper functions

// public
function selectAll(selector, parent = document) {
  if (typeof selector === 'string') {
    return Array.from(parent.querySelectorAll(selector));
  } else if (selector instanceof Element) {
    return [selector];
  } else if (selector instanceof NodeList) {
    return Array.from(selector);
  } else if (selector instanceof Array) {
    return selector;
  }
  return [];
}

function getOffsetId(id) {
  return `scrollama__debug-offset--${id}`;
}

// SETUP
function setupOffset({ id, offsetVal, stepClass }) {
  const el = document.createElement("div");
  el.id = getOffsetId(id);
  el.className = "scrollama__debug-offset";
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.width = "100%";
  el.style.height = "0";
  el.style.borderTop = "2px dashed black";
  el.style.zIndex = "9999";

  const p = document.createElement("p");
  p.innerHTML = `".${stepClass}" trigger: <span>${offsetVal}</span>`;
  p.style.fontSize = "12px";
  p.style.fontFamily = "monospace";
  p.style.color = "black";
  p.style.margin = "0";
  p.style.padding = "6px";
  el.appendChild(p);
  document.body.appendChild(el);
}

function setup({ id, offsetVal, stepEl }) {
  const stepClass = stepEl[0].className;
  setupOffset({ id, offsetVal, stepClass });
}

// UPDATE
function update({ id, offsetMargin, offsetVal, format }) {
  const post = format === "pixels" ? "px" : "";
  const idVal = getOffsetId(id);
  const el = document.getElementById(idVal);
  el.style.top = `${offsetMargin}px`;
  el.querySelector("span").innerText = `${offsetVal}${post}`;
}

function notifyStep({ id, index, state }) {
  const prefix = `scrollama__debug-step--${id}-${index}`;
  const elA = document.getElementById(`${prefix}_above`);
  const elB = document.getElementById(`${prefix}_below`);
  const display = state === "enter" ? "block" : "none";

  if (elA) elA.style.display = display;
  if (elB) elB.style.display = display;
}

function scrollama() {
  const OBSERVER_NAMES = [
    "stepAbove",
    "stepBelow",
    "stepProgress",
    "viewportAbove",
    "viewportBelow"
  ];

  let cb = {};
  let io = {};

  let id = null;
  let stepEl = [];
  let stepOffsetHeight = [];
  let stepOffsetTop = [];
  let stepStates = [];

  let offsetVal = 0;
  let offsetMargin = 0;
  let viewH = 0;
  let pageH = 0;
  let previousYOffset = 0;
  let progressThreshold = 0;

  let isReady = false;
  let isEnabled = false;
  let isDebug = false;

  let progressMode = false;
  let preserveOrder = false;
  let triggerOnce = false;

  let direction = "down";
  let format = "percent";

  const exclude = [];

  /* HELPERS */
  function err(msg) {
    console.error(`scrollama error: ${msg}`);
  }

  function reset() {
    cb = {
      stepEnter: () => {},
      stepExit: () => {},
      stepProgress: () => {}
    };
    io = {};
  }

  function generateInstanceID() {
    const a = "abcdefghijklmnopqrstuv";
    const l = a.length;
    const t = Date.now();
    const r = [0, 0, 0].map(d => a[Math.floor(Math.random() * l)]).join("");
    return `${r}${t}`;
  }

  function getOffsetTop(el) {
    const { top } = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset;
    const clientTop = document.body.clientTop || 0;
    return top + scrollTop - clientTop;
  }

  function getPageHeight() {
    const { body } = document;
    const html = document.documentElement;

    return Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );
  }

  function getIndex(element) {
    return +element.getAttribute("data-scrollama-index");
  }

  function updateDirection() {
    if (window.pageYOffset > previousYOffset) direction = "down";
    else if (window.pageYOffset < previousYOffset) direction = "up";
    previousYOffset = window.pageYOffset;
  }

  function disconnectObserver(name) {
    if (io[name]) io[name].forEach(d => d.disconnect());
  }

  function handleResize() {
    viewH = window.innerHeight;
    pageH = getPageHeight();

    const mult = format === "pixels" ? 1 : viewH;
    offsetMargin = offsetVal * mult;

    if (isReady) {
      stepOffsetHeight = stepEl.map(el => el.getBoundingClientRect().height);
      stepOffsetTop = stepEl.map(getOffsetTop);
      if (isEnabled) updateIO();
    }

    if (isDebug) update({ id, offsetMargin, offsetVal, format });
  }

  function handleEnable(enable) {
    if (enable && !isEnabled) {
      // enable a disabled scroller
      if (isReady) {
        // enable a ready scroller
        updateIO();
      } else {
        // can't enable an unready scroller
        err("scrollama error: enable() called before scroller was ready");
        isEnabled = false;
        return; // all is not well, don't set the requested state
      }
    }
    if (!enable && isEnabled) {
      // disable an enabled scroller
      OBSERVER_NAMES.forEach(disconnectObserver);
    }
    isEnabled = enable; // all is well, set requested state
  }

  function createThreshold(height) {
    const count = Math.ceil(height / progressThreshold);
    const t = [];
    const ratio = 1 / count;
    for (let i = 0; i < count; i += 1) {
      t.push(i * ratio);
    }
    return t;
  }

  /* NOTIFY CALLBACKS */
  function notifyStepProgress(element, progress) {
    const index = getIndex(element);
    if (progress !== undefined) stepStates[index].progress = progress;
    const resp = { element, index, progress: stepStates[index].progress };

    if (stepStates[index].state === "enter") cb.stepProgress(resp);
  }

  function notifyOthers(index, location) {
    if (location === "above") {
      // check if steps above/below were skipped and should be notified first
      for (let i = 0; i < index; i += 1) {
        const ss = stepStates[i];
        if (ss.state !== "enter" && ss.direction !== "down") {
          notifyStepEnter(stepEl[i], "down", false);
          notifyStepExit(stepEl[i], "down");
        } else if (ss.state === "enter") notifyStepExit(stepEl[i], "down");
        // else if (ss.direction === 'up') {
        //   notifyStepEnter(stepEl[i], 'down', false);
        //   notifyStepExit(stepEl[i], 'down');
        // }
      }
    } else if (location === "below") {
      for (let i = stepStates.length - 1; i > index; i -= 1) {
        const ss = stepStates[i];
        if (ss.state === "enter") {
          notifyStepExit(stepEl[i], "up");
        }
        if (ss.direction === "down") {
          notifyStepEnter(stepEl[i], "up", false);
          notifyStepExit(stepEl[i], "up");
        }
      }
    }
  }

  function notifyStepEnter(element, dir, check = true) {
    const index = getIndex(element);
    const resp = { element, index, direction: dir };

    // store most recent trigger
    stepStates[index].direction = dir;
    stepStates[index].state = "enter";
    if (preserveOrder && check && dir === "down") notifyOthers(index, "above");

    if (preserveOrder && check && dir === "up") notifyOthers(index, "below");

    if (cb.stepEnter && !exclude[index]) {
      cb.stepEnter(resp, stepStates);
      if (isDebug) notifyStep({ id, index, state: "enter" });
      if (triggerOnce) exclude[index] = true;
    }

    if (progressMode) notifyStepProgress(element);
  }

  function notifyStepExit(element, dir) {
    const index = getIndex(element);
    const resp = { element, index, direction: dir };

    if (progressMode) {
      if (dir === "down" && stepStates[index].progress < 1)
        notifyStepProgress(element, 1);
      else if (dir === "up" && stepStates[index].progress > 0)
        notifyStepProgress(element, 0);
    }

    // store most recent trigger
    stepStates[index].direction = dir;
    stepStates[index].state = "exit";

    cb.stepExit(resp, stepStates);
    if (isDebug) notifyStep({ id, index, state: "exit" });
  }

  /* OBSERVER - INTERSECT HANDLING */
  // this is good for entering while scrolling down + leaving while scrolling up
  function intersectStepAbove([entry]) {
    updateDirection();
    const { isIntersecting, boundingClientRect, target } = entry;

    // bottom = bottom edge of element from top of viewport
    // bottomAdjusted = bottom edge of element from trigger
    const { top, bottom } = boundingClientRect;
    const topAdjusted = top - offsetMargin;
    const bottomAdjusted = bottom - offsetMargin;
    const index = getIndex(target);
    const ss = stepStates[index];

    // entering above is only when topAdjusted is negative
    // and bottomAdjusted is positive
    if (
      isIntersecting &&
      topAdjusted <= 0 &&
      bottomAdjusted >= 0 &&
      direction === "down" &&
      ss.state !== "enter"
    )
      notifyStepEnter(target, direction);

    // exiting from above is when topAdjusted is positive and not intersecting
    if (
      !isIntersecting &&
      topAdjusted > 0 &&
      direction === "up" &&
      ss.state === "enter"
    )
      notifyStepExit(target, direction);
  }

  // this is good for entering while scrolling up + leaving while scrolling down
  function intersectStepBelow([entry]) {
    updateDirection();
    const { isIntersecting, boundingClientRect, target } = entry;

    // bottom = bottom edge of element from top of viewport
    // bottomAdjusted = bottom edge of element from trigger
    const { top, bottom } = boundingClientRect;
    const topAdjusted = top - offsetMargin;
    const bottomAdjusted = bottom - offsetMargin;
    const index = getIndex(target);
    const ss = stepStates[index];

    // entering below is only when bottomAdjusted is positive
    // and topAdjusted is negative
    if (
      isIntersecting &&
      topAdjusted <= 0 &&
      bottomAdjusted >= 0 &&
      direction === "up" &&
      ss.state !== "enter"
    )
      notifyStepEnter(target, direction);

    // exiting from above is when bottomAdjusted is negative and not intersecting
    if (
      !isIntersecting &&
      bottomAdjusted < 0 &&
      direction === "down" &&
      ss.state === "enter"
    )
      notifyStepExit(target, direction);
  }

  /*
	if there is a scroll event where a step never intersects (therefore
	skipping an enter/exit trigger), use this fallback to detect if it is
	in view
	*/
  function intersectViewportAbove([entry]) {
    updateDirection();
    const { isIntersecting, target } = entry;
    const index = getIndex(target);
    const ss = stepStates[index];

    if (
      isIntersecting &&
      direction === "down" &&
      ss.direction !== "down" &&
      ss.state !== "enter"
    ) {
      notifyStepEnter(target, "down");
      notifyStepExit(target, "down");
    }
  }

  function intersectViewportBelow([entry]) {
    updateDirection();
    const { isIntersecting, target } = entry;
    const index = getIndex(target);
    const ss = stepStates[index];
    if (
      isIntersecting &&
      direction === "up" &&
      ss.direction === "down" &&
      ss.state !== "enter"
    ) {
      notifyStepEnter(target, "up");
      notifyStepExit(target, "up");
    }
  }

  function intersectStepProgress([entry]) {
    updateDirection();
    const {
      isIntersecting,
      intersectionRatio,
      boundingClientRect,
      target
    } = entry;
    const { bottom } = boundingClientRect;
    const bottomAdjusted = bottom - offsetMargin;
    if (isIntersecting && bottomAdjusted >= 0) {
      notifyStepProgress(target, +intersectionRatio);
    }
  }

  /*  OBSERVER - CREATION */
  // jump into viewport
  function updateViewportAboveIO() {
    io.viewportAbove = stepEl.map((el, i) => {
      const marginTop = pageH - stepOffsetTop[i];
      const marginBottom = offsetMargin - viewH - stepOffsetHeight[i];
      const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
      const options = { rootMargin };
      // console.log(options);
      const obs = new IntersectionObserver(intersectViewportAbove, options);
      obs.observe(el);
      return obs;
    });
  }

  function updateViewportBelowIO() {
    io.viewportBelow = stepEl.map((el, i) => {
      const marginTop = -offsetMargin - stepOffsetHeight[i];
      const marginBottom = offsetMargin - viewH + stepOffsetHeight[i] + pageH;
      const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
      const options = { rootMargin };
      // console.log(options);
      const obs = new IntersectionObserver(intersectViewportBelow, options);
      obs.observe(el);
      return obs;
    });
  }

  // look above for intersection
  function updateStepAboveIO() {
    io.stepAbove = stepEl.map((el, i) => {
      const marginTop = -offsetMargin + stepOffsetHeight[i];
      const marginBottom = offsetMargin - viewH;
      const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
      const options = { rootMargin };
      // console.log(options);
      const obs = new IntersectionObserver(intersectStepAbove, options);
      obs.observe(el);
      return obs;
    });
  }

  // look below for intersection
  function updateStepBelowIO() {
    io.stepBelow = stepEl.map((el, i) => {
      const marginTop = -offsetMargin;
      const marginBottom = offsetMargin - viewH + stepOffsetHeight[i];
      const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
      const options = { rootMargin };
      // console.log(options);
      const obs = new IntersectionObserver(intersectStepBelow, options);
      obs.observe(el);
      return obs;
    });
  }

  // progress progress tracker
  function updateStepProgressIO() {
    io.stepProgress = stepEl.map((el, i) => {
      const marginTop = stepOffsetHeight[i] - offsetMargin;
      const marginBottom = -viewH + offsetMargin;
      const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
      const threshold = createThreshold(stepOffsetHeight[i]);
      const options = { rootMargin, threshold };
      // console.log(options);
      const obs = new IntersectionObserver(intersectStepProgress, options);
      obs.observe(el);
      return obs;
    });
  }

  function updateIO() {
    OBSERVER_NAMES.forEach(disconnectObserver);

    updateViewportAboveIO();
    updateViewportBelowIO();
    updateStepAboveIO();
    updateStepBelowIO();

    if (progressMode) updateStepProgressIO();
  }

  /* SETUP FUNCTIONS */

  function indexSteps() {
    stepEl.forEach((el, i) => el.setAttribute("data-scrollama-index", i));
  }

  function setupStates() {
    stepStates = stepEl.map(() => ({
      direction: null,
      state: null,
      progress: 0
    }));
  }

  function addDebug() {
    if (isDebug) setup({ id, stepEl, offsetVal });
  }

  function isYScrollable(element) {
    const style = window.getComputedStyle(element);
    return (
      (style.overflowY === "scroll" || style.overflowY === "auto") &&
      element.scrollHeight > element.clientHeight
    );
  }

  // recursively search the DOM for a parent container with overflowY: scroll and fixed height
  // ends at document
  function anyScrollableParent(element) {
    if (element && element.nodeType === 1) {
      // check dom elements only, stop at document
      // if a scrollable element is found return the element
      // if not continue to next parent
      return isYScrollable(element)
        ? element
        : anyScrollableParent(element.parentNode);
    }
    return false; // didn't find a scrollable parent
  }

  const S = {};

  S.setup = ({
    step,
    parent,
    offset = 0.5,
    progress = false,
    threshold = 4,
    debug = false,
    order = true,
    once = false
  }) => {
    reset();
    // create id unique to this scrollama instance
    id = generateInstanceID();

    stepEl = selectAll(step, parent);

    if (!stepEl.length) {
      err("no step elements");
      return S;
    }

    // ensure that no step has a scrollable parent element in the dom tree
    // check current step for scrollable parent
    // assume no scrollable parents to start
    const scrollableParent = stepEl.reduce(
      (foundScrollable, s) =>
        foundScrollable || anyScrollableParent(s.parentNode),
      false
    );
    if (scrollableParent) {
      console.error(
        "scrollama error: step elements cannot be children of a scrollable element. Remove any css on the parent element with overflow: scroll; or overflow: auto; on elements with fixed height.",
        scrollableParent
      );
    }

    // options
    isDebug = debug;
    progressMode = progress;
    preserveOrder = order;
    triggerOnce = once;

    S.offsetTrigger(offset);
    progressThreshold = Math.max(1, +threshold);

    isReady = true;

    // customize
    addDebug();
    indexSteps();
    setupStates();
    handleResize();
    S.enable();
    return S;
  };

  S.resize = () => {
    handleResize();
    return S;
  };

  S.enable = () => {
    handleEnable(true);
    return S;
  };

  S.disable = () => {
    handleEnable(false);
    return S;
  };

  S.destroy = () => {
    handleEnable(false);
    reset();
  };

  S.offsetTrigger = x => {
    if (x === null) return offsetVal;

    if (typeof x === "number") {
      format = "percent";
      if (x > 1) err("offset value is greater than 1. Fallback to 1.");
      if (x < 0) err("offset value is lower than 0. Fallback to 0.");
      offsetVal = Math.min(Math.max(0, x), 1);
    } else if (typeof x === "string" && x.indexOf("px") > 0) {
      const v = +x.replace("px", "");
      if (!isNaN(v)) {
        format = "pixels";
        offsetVal = v;
      } else {
        err("offset value must be in 'px' format. Fallback to 0.5.");
        offsetVal = 0.5;
      }
    } else {
      err("offset value does not include 'px'. Fallback to 0.5.");
      offsetVal = 0.5;
    }
    return S;
  };

  S.onStepEnter = f => {
    if (typeof f === "function") cb.stepEnter = f;
    else err("onStepEnter requires a function");
    return S;
  };

  S.onStepExit = f => {
    if (typeof f === "function") cb.stepExit = f;
    else err("onStepExit requires a function");
    return S;
  };

  S.onStepProgress = f => {
    if (typeof f === "function") cb.stepProgress = f;
    else err("onStepProgress requires a function");
    return S;
  };

  return S;
}

//

var script = {
  inheritAttrs: false,
  name: 'Scrollama',
  mounted () {
    this._scroller = scrollama();
    this.setup();
  },
  beforeDestroy() {
    this._scroller.destroy();
  },
  computed: {
    opts() {
      return Object.assign({},  {
        step: Array.from(this.$el.children),
        progress: !!this.$listeners['step-progress']
      }, this.$attrs);
    }
  },
  methods: {
    setup() {
      this._scroller.destroy();

      this._scroller
        .setup(this.opts)
        .onStepProgress(resp => {
          this.$emit('step-progress', resp);
        })
        .onStepEnter(resp => {
          this.$emit('step-enter', resp);
        })
        .onStepExit(resp => {
          this.$emit('step-exit', resp);
        });

      window.addEventListener('resize', this.handleResize);
    },
    handleResize () {
      this._scroller.resize();
    }
  }
};

function normalizeComponent(template, style, script, scopeId, isFunctionalTemplate, moduleIdentifier /* server only */, shadowMode, createInjector, createInjectorSSR, createInjectorShadow) {
    if (typeof shadowMode !== 'boolean') {
        createInjectorSSR = createInjector;
        createInjector = shadowMode;
        shadowMode = false;
    }
    // Vue.extend constructor export interop.
    const options = typeof script === 'function' ? script.options : script;
    // render functions
    if (template && template.render) {
        options.render = template.render;
        options.staticRenderFns = template.staticRenderFns;
        options._compiled = true;
        // functional template
        if (isFunctionalTemplate) {
            options.functional = true;
        }
    }
    // scopedId
    if (scopeId) {
        options._scopeId = scopeId;
    }
    let hook;
    if (moduleIdentifier) {
        // server build
        hook = function (context) {
            // 2.3 injection
            context =
                context || // cached call
                    (this.$vnode && this.$vnode.ssrContext) || // stateful
                    (this.parent && this.parent.$vnode && this.parent.$vnode.ssrContext); // functional
            // 2.2 with runInNewContext: true
            if (!context && typeof __VUE_SSR_CONTEXT__ !== 'undefined') {
                context = __VUE_SSR_CONTEXT__;
            }
            // inject component styles
            if (style) {
                style.call(this, createInjectorSSR(context));
            }
            // register component module identifier for async chunk inference
            if (context && context._registeredComponents) {
                context._registeredComponents.add(moduleIdentifier);
            }
        };
        // used by ssr in case component is cached and beforeCreate
        // never gets called
        options._ssrRegister = hook;
    }
    else if (style) {
        hook = shadowMode
            ? function (context) {
                style.call(this, createInjectorShadow(context, this.$root.$options.shadowRoot));
            }
            : function (context) {
                style.call(this, createInjector(context));
            };
    }
    if (hook) {
        if (options.functional) {
            // register for functional component in vue file
            const originalRender = options.render;
            options.render = function renderWithStyleInjection(h, context) {
                hook.call(context);
                return originalRender(h, context);
            };
        }
        else {
            // inject component registration as beforeCreate hook
            const existing = options.beforeCreate;
            options.beforeCreate = existing ? [].concat(existing, hook) : [hook];
        }
    }
    return script;
}

/* script */
const __vue_script__ = script;

/* template */
var __vue_render__ = function () {var _vm=this;var _h=_vm.$createElement;var _c=_vm._self._c||_h;return _c('div',{staticClass:"scrollama__steps"},[_vm._t("default")],2)};
var __vue_staticRenderFns__ = [];

  /* style */
  const __vue_inject_styles__ = undefined;
  /* scoped */
  const __vue_scope_id__ = undefined;
  /* module identifier */
  const __vue_module_identifier__ = undefined;
  /* functional template */
  const __vue_is_functional_template__ = false;
  /* style inject */
  
  /* style inject SSR */
  
  /* style inject shadow dom */
  

  
  const __vue_component__ = /*#__PURE__*/normalizeComponent(
    { render: __vue_render__, staticRenderFns: __vue_staticRenderFns__ },
    __vue_inject_styles__,
    __vue_script__,
    __vue_scope_id__,
    __vue_is_functional_template__,
    __vue_module_identifier__,
    false,
    undefined,
    undefined,
    undefined
  );

export default __vue_component__;
