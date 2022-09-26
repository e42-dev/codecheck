'use strict'

/*
  (C) Cay S. Horstmann 2018-2022. All Rights Reserved.
*/

/*

Glossary

Simulation: The data structure that renders the items to be displayed and
handles user interaction.

Item: Anything that can be displayed, either top-level or embedded as
a value in a node. Must have a property $element with the HTML
element that renders the item. If it has an $attach method, it is
called when the element is first rendered, so that the item can register
listeners with the simulation.

Node: An item that holds named values. Values can be scalars
(string, number, boolean), pointers, and embedded nodes. Subclasses must
define $setVisual, $deleteVisual.

Path: The location of a value in a node. It has an $assign method
to update the value and a $visual, the element containing the visual
representation of the value. They are called paths because they come from
expressions of the form topLevelNode.name1.name2 
Scalar values are wrapped into objects (String, Number, Boolean) so that 
   (1) they can be used in expressions and
   (2) they can have $assign and $visual properties

Pointer: An arrow from the visual of a path to either a top-level item or
the visual of another path

*/

import { horstmann_common, _ } from './e42_common.mjs'

const setup = []

export const addExercise = (algo, config) => { setup.push({ algo, config }) }

const NARROW_NO_BREAK_SPACE = '\u{202F}'

// --------------------------------------------------------------------

export class Buttons {
  constructor() {
    this.$element = document.createElement('div')
    this.$element.classList.add('buttons')
    this.actions = {}
  }

  $attach(sim) {
    this.$sim = sim
    for (const child of this.$element.children)
      sim.selectable(child)
  }

  add(label, action) {
    let button = document.createElement('span')
    button.classList.add('hc-button')
    button.classList.add('hc-step')
    button.innerHTML = label
    this.$element.appendChild(button)
    this.$sim?.selectable(button)
    this.actions[label] = action
  }

  ask(label) {
    return {
      type: 'select',
      prompt: 'Click one of the blue buttons.', // TODO i18n
      elements: [...this.$element.children].filter(b => b.innerHTML === label),
      done: this.actions[label]()
    }
  }
}

export class Code {
  static AFTER_ERROR_DELAY = 500

  constructor(code) {
    this.currentLine = 0

    this.$element = document.createElement('div')
    this.$element.classList.add('codelines')
    this.$element.classList.add('hc-code')
    let lines = code.split('\n')
    this.lines = []
    // Ignore leading/trailing blank lines
    let start = 0
    while (start < lines.length && lines[start].trim() === '')
      start++
    let end = lines.length - 1
    while (end >= 0 && lines[end].trim() === '')
      end--
    for (let i = start; i <= end; i++)
      this.lines.push(lines[i])
  }

  $attach(sim) {
    for (let i = 0; i < this.lines.length; i++) {
      let line = document.createElement('span')
      line.innerHTML = this.lines[i]
      if (this.isSelectable(this.lines[i]))
        sim.selectable(line)
      this.$element.appendChild(line)
    }
    this.go(1)
  }

  isSelectable(line) { // TODO: Allow customization
    return !['', '{', '}', 'else', 'else:', 'else :', 'do'].includes(line.trim())
  }

  nextLine() {
    for (let i = this.currentLine + 1; i <= this.lines.length; i++) {
      if (this.isSelectable(this.lines[i - 1]))
        return i
    }
    return -1
  }

  // User API

  go(line) {
    line = line ?? this.nextLine()
    if (1 <= this.currentLine && this.currentLine <= this.$element.children.length)
      this.$element.children[this.currentLine - 1].classList.remove('selected-line')
    this.currentLine = line
    if (1 <= line && line <= this.$element.children.length)
      this.$element.children[line - 1].classList.add('selected-line')
    return this
  }

  ask(...lines) {
    const prompt = lines.length > 0 && typeof lines[lines.length - 1] === 'string'
        ? lines.pop() : _('click_line_inst')
    if (lines.length == 0) lines[0] = this.nextLine()
    return {
      type: 'select',
      elements: lines.map(line => this.$element.children[line - 1]),
      done: () => this.go(lines[0]),
      prompt
    }
  }
}

// --------------------------------------------------------------------

export class Terminal {
  constructor() {
    this.$element = document.createElement('pre')
    this.$element.classList.add('terminal')
    this.$element.classList.add('hc-code')
  }

  // User API

  print(line) {
    const span = document.createElement('span')
    span.textContent = line
    this.$element.appendChild(span)
    return this
  }

  println(line) {
    const span = document.createElement('span')
    span.textContent = line
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    return this
  }

  input(line) {
    const span = document.createElement('span')
    span.classList.add('input')
    span.textContent = line
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    return this
  }

  ask(line) {
    const span = document.createElement('span')
    span.textContent = ''
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    if (line === undefined) span.classList.add('input')
    return {
      type: 'input',
      element: span,
      select: false,
      value: line,
      prompt: 'Enter the next output',
      done: (inputText) => span.textContent = line ?? inputText
    }
  }
}

// --------------------------------------------------------------------

export class Null {
  toString() { return 'null' } // TODO In Python it's 'None'
}

// --------------------------------------------------------------------

/**
  The address of a non-heap value (only in C style languages)
*/ 
export class Addr { 
  /**
   * @param path A path to a memory location
   */
  constructor(path) {
    if (!('$assign' in path)) alert(`Addr constructed with non-path ${path}`)
    this.$path = path
  }
  /**
   * The memory location of which this is the address
   */
  deref() {
    return this.$path
  }
}

// --------------------------------------------------------------------

/**
   An item that holds named values.
*/

class Node {
  constructor() {
    this.$values = {} // A map from names to paths
  }

  $attach(sim) {
    this.$sim = sim
    for (const name in this.$values) { 
      this.$setVisual(name, this.$values[name])
      // Note: This calls $sim.renderValue, which calls $attach for embedded nodes
    }
  }

  /**
     Wraps the given value in an object so that methods can be attached to it.
     Clones if necessary. Called only by $set.
  */
  $wrap(value) {
    let result
    if (value === undefined) {
      result = new String('')
    } else if (horstmann_common.isString(value)) {
      result = new String(value)
    } else if (horstmann_common.isNumeric(value)) {
      result = new Number(value)
    } else if (horstmann_common.isBoolean(value)) {
      result = new Boolean(value)
    } else if (value === null || typeof value === 'object' && value instanceof Null) {
      result = new Null()
    } else if (typeof value !== 'object') {
      alert(`Path cannot have value ${value}`)
    } else if (value instanceof Addr) {
      result = new Addr(value.deref())
    } else {
      result = value // Obj, Arr, etc. 
      // TODO Should be cloned. Right now, a = new Obj(), vars.b = a; vars.c = a; won't work
      // https://developer.mozilla.org/en-US/docs/Web/API/structuredClone
    }
    return result
  }

  /**
     Return this.$proxy() from subclass constructors.
  */
  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key.toString().startsWith('$'))
          return target[key]
        else {
          return target.$get(key)
        }
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else
          target.$set(key, value)
        return true
      },
      deleteProperty(target, key) {
        return target.$delete(key)
      }
    }
    return new Proxy(this, handler)
  }

  /**
     Gets a value. Called from $proxy.
  */
  $get(name) {
    return this.$values[name]
  }

  /**
     Sets a name/value. Called from $proxy.
  */
  $set(name, value) {
    const path = this.$wrap(value)
    path.$assign = (newValue) => { this.$set(name, newValue) }
    this.$values[name] = path
    if (this.$sim !== undefined) this.$setVisual(name, path)
  }

  /**
     Deletes a name/value. Called from $proxy.
  */
  $delete(name) {
    if (!(name in this.$values)) return false
    delete this.$values[name]
    this.$deleteVisual(name)
    return true
  }

  /**
     Applies f to each name/value in this node and all embedded nodes
     @param f a function receiving a name and value
  */
  $forEachDescendant(f) {
    for (const name in this.$values) {
      const value = this.$values[name]
      f(name, value)
      if (value instanceof Node)
        value.$forEachDescendant(f)
    }
  }
}

class TableNode extends Node {

  // Args [title], [config]

  constructor(...args) {
    super()
    this.$element = document.createElement('div')
    let nextArg = 0

    if (args.length > nextArg && typeof args[nextArg] === 'string') {
      const body = this.$element.getElementsByTagName('tbody')[0]
      const title = document.createElement('div')
      title.classList.add('title')
      title.classList.add('hc-code')
      title.innerHTML = args[nextArg]
      this.$element.appendChild(title)
      nextArg++
    }

    if (args.length > nextArg && typeof args[nextArg] === 'object') {
      this.$config = args[nextArg]
    } else {
      this.$config = {}
    }
  }

  $attach(sim) {
    super.$attach(sim)
    sim.selectable(this.$element)
    sim.connectionTarget(this.$element)
  }

  $setVisual(name, path) {
    if('$hidden' in this && this.$hidden.includes(name)) return
    let nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === name)
    if (nameElement === undefined) {
      this.$addRow(name)
      nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === name)
    }
    const valueElement = nameElement.nextSibling
    if (path instanceof Node) {
      nameElement.classList.add('fat')
      valueElement.classList.add('fat')
    } else {
      nameElement.classList.remove('fat')
      valueElement.classList.remove('fat')
    }
    path.$visual = valueElement.firstChild
    this.$sim.renderValue(path)
  }

  $deleteVisual(name) {
    if (this.$sim === undefined) return    
    const nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === name)
    if (nameElement !== undefined) {
      nameElement.nextSibling.remove()
      nameElement.remove()
      this.$sim.resize()
    }
  }

  $addRow(field) {
    const nameElement = document.createElement('div')
    nameElement.classList.add('name')
    nameElement.classList.add('hc-code')
    nameElement.textContent = field
    this.$element.appendChild(nameElement)
    const valueElement = document.createElement('div')
    valueElement.classList.add('value')
    this.$element.appendChild(valueElement)
    let fieldValueSpan = document.createElement('span')
    valueElement.appendChild(fieldValueSpan)
    if ('dropHistory' in this.$config) {
      fieldValueSpan.classList.add('dropHistory')
      fieldValueSpan.textContent = NARROW_NO_BREAK_SPACE
    } else {
      let emptySpan = document.createElement('span')
      emptySpan.textContent = NARROW_NO_BREAK_SPACE
      fieldValueSpan.appendChild(emptySpan)
    }
    this.$sim.editable(fieldValueSpan)
    this.$sim.connectionSource(fieldValueSpan)
    if (this.$sim.language === 'cpp') {
      this.$sim.connectionTarget(fieldValueSpan)
      this.$sim.selectable(fieldValueSpan)
    }
    this.$sim.resize()
  }
}

export class Obj extends TableNode {
  constructor(...args) {
    super(...args)
    this.$element.classList.add('object')
    return this.$proxy()
  }
}

export class Frame extends TableNode {
  constructor(...args) {
    super(...args)
    this.$element.classList.add('frame')
    return this.$proxy()
  }
}

export class Arr extends TableNode  {
  constructor(...args) {
    super(...args)
    this.$element.classList.add('array')
    this.$values.length = 0
    this.$hidden = ['length']
    return this.$proxy()
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key.toString().startsWith('$'))
          return target[key]
        else
          return target.$get(key)
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else if (key === 'length') {
          let currentLength = target.$values.length
          target.$values.length = value
          while (currentLength < value) {
            target.$set('' + currentLength, '')
            currentLength++
          }
          while (currentLength > value) {
            currentLength--
            target.$delete(currentLength)
          }
        }
        else if (key.match(/[0-9]+/)) {
          let currentLength = target.$values.length
          if (currentLength <= key) {
            receiver.length = Number.parseInt(key) + 1
          }
          target.$set(key, value)
        }
        return true
      }
    }
    return new Proxy(this, handler)
  }
}

export class Seq {
  constructor(values) {
    this.$element = document.createElement('table')
    this.$element.classList.add('seq')
    this.$element.appendChild(document.createElement('tr'))
    this.$values = []
    if (values !== undefined)
      for (const v of values)
        this.$set(this.$values.length, v)

    return this.$proxy()
  }

  $setVisual(n, path) {
    if (n >= this.$values.length) this.$addElements(n - this.$values.length + 1)
    const cell = this.$element.getElementsByTagName('tr')[0].children[n]
    path.$visual = cell
    this.$sim.renderValue(path)
  }

  $addElements(n) {
    const row = this.$element.getElementsByTagName('tr')[0]
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('td')
      row.appendChild(cell)
    }
  }

  $deleteElements(n) {
    const cells = this.$element.getElementsByTagName('tr')[0].children
    for (let i = 0; i < n; i++) {
      cells[cells.length - 1].remove()
    }
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key.toString().startsWith('$'))
          return target[key]
        else
          return target.$values[key]
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else if (key === 'length') {
          let currentLength = target.$values.length
          target.$values.length = value
          if (currentLength < value) {
            target.$addElements(value - currentLength)
          }
          if (currentLength > value) {
            target.$deleteElements(currentLength - value)
          }
        }
        else if (key.match(/[0-9]+/)) {
          let currentLength = target.$values.length
          if (currentLength <= key) {
            receiver.length = Number.parseInt(key) + 1
          }
          target.$set(key, value)
        }
        return true
      }
    }
    return new Proxy(this, handler)
  }
}

// ====================================================================

window.addEventListener('load', () => {
  const PLAY_STEP_DELAY = 1000
  const SHOW_STEP_DELAY = 1000
  const REMOVE_X = '✘'

  /**
     Tests whether a value is a top-level node.
  */
  const isTopLevel = (value) =>
        typeof value === 'object' && '$element' in value &&
        value.$element.classList.contains('heap')

  const initElement = (element, prefix, { algo, config }) => {
    // Element-scoped variables
    let commonUI = undefined
    let arena = undefined
    let elements = []
    let pointers = new Map()
      // maps $visual of start to { svg, to: $visual or $element of end }
    let pointeds = new Map()
      // maps $visual or $element of end to set of $visual of starts
    let stepIter = undefined
    let currentStepIndex = undefined
    let currentStep = undefined
    let currentStepStarted = undefined
    let currentStepResult = undefined
    let pointerStarted = false

    // Utility functions accessed in sim
    const str = obj => {
      let result = obj.toString();
      if (result === '') result = '&#160;';
      return result;
    }

    function isNumeric(x) {
      return !isNaN(parseFloat(x)) && isFinite(x);
    }
    function isString(x) {
      return typeof x === 'string' || ((!!x && typeof x === 'object') && Object.prototype.toString.call(x) === '[object String]');
    }

    /*
      Converts pixels in the object arena to em
    */
    const pxToEm = x => {
      //let pxPerRem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      let pxPerEm = parseFloat(window.getComputedStyle(arena.parentNode).fontSize)
      return x / pxPerEm / horstmann_common.getScaleFactor();
    }

    const setPosition = (element, x, y) => {
      element.style.position = 'absolute'
      element.style.left = (x * 4) + 'em' // TODO
      element.style.top = (y * 2.75) + 'em'
    }

    /*
      Gets the bounds of a DOM element in the arena
    */
    const getBounds = e => {
      let outerRect = arena.getBoundingClientRect()
      let innerRect = e.getBoundingClientRect()
      return {
        x: pxToEm(innerRect.left - outerRect.left),
        y: pxToEm(innerRect.top - outerRect.top),
        width: pxToEm(innerRect.width),
        height: pxToEm(innerRect.height)
      }
    }

    /*
      Gets the extent of an array of elements
    */
    const getExtent = elements => {
      let result = {
        width: 0,
        height: 0
      }
      for (let i = 0; i < elements.length; i++) {
        let bounds = getBounds(elements[i])
        result.width = Math.max(result.width, bounds.x + bounds.width)
        result.height = Math.max(result.height, bounds.y + bounds.height)
      }
      return result
    }

    /*
      Resizes the arena and svg to hold all elements.
    */
    const resize = () => {
      let extent = getExtent(elements)
      let svg = arena.nextSibling
      let svgBounds = svg.getBBox()
      let height = Math.max(extent.height, svgBounds.y + svgBounds.height)
      let width = svgBounds.width === 0 ? extent.width * 1.15 : Math.max(extent.width, svgBounds.x + svgBounds.width) + 0.1
      svg.setAttribute('viewBox', `0 0, ${width} ${height}`)
      svg.style.width = width + 'em'
      svg.style.height = height + 'em'

      arena.style.width = width + 'em'
      arena.style.height = height + 'em'
      arena.parentNode.style.height = height + 'em'
    }

    // TODO Make variable
    // TODO https://dragonman225.js.org/curved-arrows.html
    const drawPointer = (from, toBounds) => {
      // TODO attachments
      const minSWidth = 0.8
      const arrowWidth = 0.4
      const attachmentHeight = 0.6
      const attachmentWidth = 0.40
      const maxCWidth = 3
      const minDelta = 2
      const maxDelta = 6

      const fromBounds = getBounds(from)
      let forward = fromBounds.x + fromBounds.width <= toBounds.x

      let x1 = fromBounds.x + fromBounds.width / 2
      let y1 = fromBounds.y + fromBounds.height / 2

      let outerFrom = getBounds(from.parentNode.parentNode)
      let x1outer = outerFrom.x + outerFrom.width + attachmentWidth

      let initial = `M ${x1} ${y1} L ${x1outer} ${y1}`
      let curve = undefined
      let arrow = undefined

      let attachment = 1

      let attachmentY = forward ? attachmentHeight :
          attachmentHeight * 3 / 2 // So that forward/backwards arrows don't cross
      // For narrow height objects, add all arrows in the middle
      if (toBounds.height < 2 * attachmentY) {
        attachmentY = toBounds.height / 2;
        attachment = 1;
      }

      let y2 = toBounds.y + attachmentY * attachment

      if (forward) {
        // S-shaped
        let x2 = toBounds.x - 2 * arrowWidth

        let cp1x = x1outer + Math.abs(y2 - y1) * 0.5
        let cp1y = y1
        let cp2x = x2 - Math.abs(y2 - y1) * 0.5
        let cp2y = y2
        curve = `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2} L ${x2 + arrowWidth} ${y2}`
        arrow = `M ${x2 + 2 * arrowWidth} ${y2} L ${x2 + arrowWidth} ${y2 - arrowWidth / 2} L ${x2 + arrowWidth} ${y2 + arrowWidth / 2} Z`
      } else if (toBounds.x + toBounds.width > fromBounds.x || y2 < outerFrom.y || y2 > outerFrom.y + outerFrom.height) {
        // Reverse C-shaped
        let x2 = toBounds.x + toBounds.width + 2 * arrowWidth
        let xmax = Math.max(x1outer, x2)
        let xmid = xmax + Math.min(maxCWidth, Math.abs(y1 - y2) * 0.25)
        let ymid = (y1 + y2) / 2
        curve = `L ${xmax} ${y1} Q ${xmid} ${y1}, ${xmid} ${ymid} Q ${xmid} ${y2}, ${xmax} ${y2} L ${x2 - arrowWidth} ${y2}`
        arrow = `M ${x2 - 2 * arrowWidth} ${y2} L ${x2 - arrowWidth} ${y2 - arrowWidth / 2} L ${x2 - arrowWidth} ${y2 + arrowWidth / 2} Z`
      } else {
        // Reverse C to start of outerFrom, then Bézier
        let outerYmid = outerFrom.y + outerFrom.height / 2
        let delta = minDelta + (maxDelta - minDelta) * Math.abs(y1 / outerYmid - 1)
        let x3 = outerFrom.x - delta
        let y3 = y1 > outerFrom.y + outerFrom.height / 2 ?
            outerFrom.y + outerFrom.height + delta :
            outerFrom.y - delta
        let xmid = x1outer + Math.min(maxCWidth, Math.abs(y1 - y3) * 0.25)
        let ymid = (y1 + y3) / 2

        let x2 = toBounds.x + toBounds.width + 2 * arrowWidth

        let cp1x = x3 - Math.abs(y2 - y3) * 0.5
        let cp1y = y3
        let cp2x = x2 + Math.abs(y2 - y3) * 0.5
        let cp2y = y2
        curve = `Q ${xmid} ${y1}, ${xmid} ${ymid} Q ${xmid} ${y3}, ${x1outer} ${y3} L ${x3} ${y3} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2} L ${x2 - arrowWidth} ${y2}`
        arrow = `M ${x2 - 2 * arrowWidth} ${y2} L ${x2 - arrowWidth} ${y2 - arrowWidth / 2} L ${x2 - arrowWidth} ${y2 + arrowWidth / 2} Z`
      }

      let tempDiv = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      tempDiv.innerHTML = `<g><path d="${initial} ${curve}" stroke="black" fill="none" stroke-width="0.075"/><path d="${arrow}" fill="black"/></g>`
      return tempDiv.firstChild
    }

    const selected = (element) => {
      if (currentStep === undefined || currentStep.type !== 'select' || element.classList.contains('hc-bad')) return
      if (currentStepStarted) return
      currentStepStarted = true
      if (currentStep.elements.indexOf(element) >= 0) {
        element.classList.add('hc-good')
        setTimeout(() => { element.classList.remove('hc-good') }, PLAY_STEP_DELAY)
        currentStepStarted = false
        stepCompleted(true, currentStep.value)
      } else {
        element.classList.add('hc-bad')
        setTimeout(() => {
          currentStepStarted = false
        }, Code.AFTER_ERROR_DELAY) // TODO: Is this so one can't click twice?
        stepCompleted(false)
      }
    }

    const editStarted = (element) => {
      if (currentStep === undefined || currentStep.type !== 'input') return
      if (element !== undefined) {
        if (element !== currentStep.element) {
          element.classList.add('hc-bad')
          stepCompleted(false)
          return
        } else {
          commonUI.instruction(null, {
            removeBadMarkers: true, // TODO: Really?
            secondary: 'Enter the new value' // TODO: i18n
          })
        }
      }
      commonUI.inputOver(element, (inputText, target) => {
        let answer = currentStep.value
        if (answer === undefined) {
          stepCompleted(true, inputText)
        }
        else if (horstmann_common.matches(inputText, answer)) {
          if (element !== undefined) {
            element.classList.add('hc-good')
            setTimeout(() => { element.classList.remove('hc-good') }, PLAY_STEP_DELAY)
          }
          stepCompleted(true, inputText)
        } else {
          stepCompleted(false)
        }
      })
    }

    const startPointer = (element) => {
      if (currentStep === undefined || currentStep.type !== 'connect') return
      if (currentStep.source !== element) {
        element.classList.add('hc-bad')
        stepCompleted(false)
      }

      // TODO in the objectdiagram code, it restricted focus to
      // only pointer targets

      pointerStarted = true
      commonUI.instruction(null, { secondary: _('od_arrow_end')}, {
        removeBadMarkers: true
      })
      element.focus()
    }

    function completePointer(element) {
      pointerStarted = false
      repaintRubberband()
      if (element === currentStep.target) {
        stepCompleted(true, currentStep.target)
      } else {
        element.classList.add('hc-bad')
        commonUI.instruction(null, { secondary: _('od_arrow_start') })
        stepCompleted(false)
      }
    }

    const stepCompleted = (success, result) => {
      if (success) {
        if ('done' in currentStep) currentStep.done(result)
        currentStepResult = result
        element.state.lastStep = currentStepIndex
        commonUI.correct(element.state)
        prepareNextStep()
      } else { // TODO: Check if afterAction is appropriate
        commonUI.error(element.state, doStep, {
          afterAction: prepareNextStep
        })
      }
    }

    const sim = { // The object that is passed to the algorithm
      // Utility functions
      randInt: (a, b) => {
        // a <= r <= b
        return Math.floor(a + (b - a + 1) * Math.random());
      },
      randIntArray: (n, low, high) => {
        let a = [];
        for (let i = 0; i < n; i++) {
          a.push(sim.randInt(low, high));
        }
        return a;
      },
      randIntArray2: (r, c, low, high) => {
        let a = [];
        for (let i = 0; i < r; i++) {
          let b = [];
          for (let _j2 = 0; _j2 < c; _j2++) {
            b.push(sim.randInt(low, high));
          }
          a.push(b);
        }
        return a;
      },
      randSelect: (...args) => {
        return args[sim.randInt(0, args.length - 1)];
      },
      randString: (len, a, b) => {
        var result = ""
        for (var i = 0; i < len; i++)
          result += sim.randCodePoint(a, b)
        return result;
      },
      randCodePoint: (c, d) => {
        var a = Number.isInteger(c) ? c : c.codePointAt(0); 
        var b = Number.isInteger(d) ? d : d.codePointAt(0);
        return String.fromCodePoint(sim.randInt(a, b))
      },

      // Public API
      
      pause: (prompt) => {
        return {
          type: 'pause',
          prompt
        }
      },

      start: (state, prompt) => {
        return {
          type: 'start',
          state,
          prompt
        }
      },

      next: (prompt) => {
        return {
          type: 'next',
          prompt
        }
      },

      click: (label, prompt) => {
        return {
          type: 'click',
          prompt: prompt ?? 'Click one of the blue buttons.', // TODO i18n
          value: label
        }
      },

      select: (value, prompt) => {
        return {
          type: 'select',
          elements: [value.$element], // TODO Decouple sim from $element?
          value,
          prompt
        }
      },

      ask: (value, prompt) => {
        if (value instanceof Addr) {
          return {
            type: 'select',
            elements: [value.deref().$visual],
            value,
            prompt: prompt ?? 'Select the pointer target.',
          }
        } else if (isTopLevel(value)) {
          return {
            type: 'select',
            elements: [value.$element],
            value,
            prompt: prompt ?? 'Select the pointer target.',
          }
        } else { // scalar
          return {
            type: 'input',
            select: true,
            value,
            prompt: prompt ?? 'Enter the new value.', // TODO i18n
          }
        }
      },

      /**
         @param lhs a path
         @param rhs the value to be set: An Addr, heap node, or scalar (string, number, boolean)
         @param prompt the optional prompt
      */
      set: (lhs, rhs, prompt) => {
        if (!('$assign' in lhs)) {
          alert(`${lhs} is not a path`)
        }
        if (rhs instanceof Addr) {
          return {
            type: 'connect',
            source: lhs.$visual,
            target: rhs.deref().$visual, // TODO pointers to fields
            prompt: prompt ?? 'Select the start and the end of the arrow.',
            done: () => lhs.$assign(rhs)
          }
        } else if (isTopLevel(rhs)) {
          return {
            type: 'connect',
            source: lhs.$visual,
            target: rhs.$element,
            prompt: prompt ?? 'Select the start and the end of the arrow.',
            done: () => lhs.$assign(rhs)
          }
        } else { // scalar
          return {
            type: 'input',
            value: rhs,
            prompt: prompt ?? 'Update the value.', // TODO i18n
            element: lhs.$visual,
            select: true,
            done: () => lhs.$assign(rhs)
          }
        }
      },

      add: (x, y, item) => {
        if (!sim.silent) {
          if (!('$sim' in item))
            item.$attach?.(sim)
          if (item instanceof Node) 
            item.$element.classList.add('heap')
          elements.push(item.$element)
          setPosition(item.$element, x, y)
          arena.appendChild(item.$element)
          resize()
        }
        return item
      },
      remove: (item) => {
        // Any pointers from or to this item need to be removed
        if (item instanceof Node) {
          item.$forEachDescendant((name, path) => {
            sim.removePointerFrom(path.$visual)
            sim.removePointersTo(path.$visual)
          })
        }
        sim.removePointerFrom(item.$element)
        sim.removePointersTo(item.$element)

        const index = elements.indexOf(item.$element)
        if (index >= 0) {
          elements.splice(index, 1)
          arena.removeChild(item.$element)
          resize()
        }
      },

      resize: () => {
        if (sim.silent) return
        resize()
      },

      addButtons: (...labels) => {
        if (sim.silent) return
        for (const label of labels) {
          commonUI.addButton(label, (button) => {
            if (currentStep === undefined || currentStep.type !== 'click' || button.classList.contains('hc-bad')) return
            if (currentStepStarted) return
            currentStepStarted = true
            if (currentStep.value === button.innerHTML.toString()) {
              button.classList.add('hc-good')
              setTimeout(() => { button.classList.remove('hc-good') }, PLAY_STEP_DELAY)
              currentStepStarted = false
              stepCompleted(true, currentStep.value)
            } else {
              button.classList.add('hc-bad')
              setTimeout(() => {
                currentStepStarted = false
              }, Code.AFTER_ERROR_DELAY) // TODO: Is this so one can't click twice?
              stepCompleted(false)
            }
          })
        }
      },

      // Internal API

      /**
         @param path the path to the value
      */
      renderValue: (path) => {
        if (typeof path === 'object' && 'type' in path) {
          alert(`Right hand side is ${JSON.stringify(path)}. Did you forget a yield?`)
          return
        }
        const visual = path.$visual
        if (horstmann_common.isScalar(path)) {
          let content = '' + path
          if (path === undefined || content.length == 0) content = NARROW_NO_BREAK_SPACE
          if (visual.classList.contains('dropHistory')) {
            visual.textContent = content
          } else {
            if (visual.children.length > 0) {
              if (visual.lastChild.textContent === NARROW_NO_BREAK_SPACE)
                visual.lastChild.remove()
              else
                visual.lastChild.classList.add('history')
            }
            const newContent = document.createElement('span')
            newContent.textContent = content
            visual.appendChild(newContent)
          }
        } else if (isTopLevel(path)) {
          visual.textContent = NARROW_NO_BREAK_SPACE
          sim.addPointer(visual, path.$element)
        } else if (path instanceof Addr) {
          visual.textContent = NARROW_NO_BREAK_SPACE
          sim.addPointer(visual, path.deref().$visual)
        } else if (path instanceof Node) { // embedded
          if (!('$sim' in path)) {
            path.$element.classList.add('struct')            
            path.$attach?.(sim)
          }
          visual.innerHTML = ''
          visual.appendChild(path.$element)
        }
      },

      removePointerFrom: (from) => {
        if (sim.silent) return
        if (pointers.has(from)) {
          let data = pointers.get(from)
          data.svg.remove()
          pointeds.get(data.to)?.delete(from)
          pointers.delete(from)
        }        
      },

      removePointersTo: (to) => {
        if (sim.silent) return
        if (pointeds.has(to)) {
          for (const from of [...pointeds.get(to)]) {
            sim.removePointerFrom(from)
            from.textContent = '⚠'
          }
        }
      },
      
      addPointer: (from, to) => {
        if (sim.silent) return
        sim.removePointerFrom(from)
        let svgs = arena.nextSibling
        const svg = drawPointer(from, getBounds(to))
        pointers.set(from, { svg, to })
        let froms = pointeds.get(to)
        if (froms === undefined) {
          froms = new Set()
          pointeds.set(to, froms)
        }
        froms.add(from)
        svgs.appendChild(svg)
      },

      selectable: element => {
        element.tabIndex = 0
        element.addEventListener('click', e => {
          selected(element)
        })
        element.addEventListener('dblclick', e => {
          e.preventDefault()
        })
        element.addEventListener('keydown', e => {
          if (currentStep === undefined || currentStep.type !== 'select') return
          if (e.keyCode === 32) {
            e.stopPropagation();
            e.preventDefault();
            selected(element)
          }
        })
      },

      editable: element => {
        element.tabIndex = 0
        element.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          editStarted(element)
        })
        element.addEventListener('dblclick', e => {
          e.preventDefault()
        })
        element.addEventListener('keydown', e => {
          if (currentStep === undefined || currentStep.type !== 'input') return
          if (e.keyCode === 32) {
            e.stopPropagation();
            e.preventDefault();
            editStarted(element)
          }
        })
      },

      connectionSource: element => {
        element.addEventListener('keydown', function(e) {
          if (currentStep === undefined || currentStep.type !== 'connect') return
          if (pointerStarted) return
          if (e.keyCode === 32) {
            e.stopPropagation();
            e.preventDefault();
            startPointer(element)
          }
        })

        let mousedownListener = function(e) {
          if (currentStep === undefined || currentStep.type !== 'connect') return
          if (pointerStarted) return
          e.stopPropagation()
          startPointer(element)
        }
        element.addEventListener('mousedown', mousedownListener)
        element.addEventListener('touchstart', mousedownListener, {passive: true})

        // If the mouse goes up where it went down, don't count the
        // event. Otherwise, it's not possible to click on the source
        // and the target separately
        let mouseupListener = function(e) {
          if (pointerStarted && currentStep.source === element) {
            e.stopPropagation()
          }
        }
        element.addEventListener('mouseup', mouseupListener)
        element.addEventListener('touchend', mouseupListener)

      },
      connectionTarget: element => {
        element.addEventListener('keydown', function(e) {
          if (!pointerStarted) return
          if (e.keyCode === 32) {
            e.stopPropagation();
            e.preventDefault();
            completePointer(element)
          }
        })
        element.addEventListener('focus', function(e) {
          if (pointerStarted && currentStep.source !== element) {
            repaintRubberband(getBounds(element))
          }
        })

        let mouseupListener = function(e) {
          if (pointerStarted && currentStep.source !== element) {
            e.stopPropagation()
            completePointer(element)
          }
        }
        element.addEventListener('mouseup', mouseupListener)
        element.addEventListener('touchend', mouseupListener)
      },
    }

    // Plays the remaining steps with a delay
    const playSteps = doneAction => {
      getNextStep()
      if (currentStep !== undefined) {
        doStep()
        setTimeout(() => { playSteps(doneAction) }, PLAY_STEP_DELAY)
      }
      else
        doneAction()
    }

    /**
      Does the current step non-interactively (in play, show next steps)
    */
    const doStep = () => {
      if (currentStep.type === 'select') {
        let element = currentStep.elements[0]
        element.classList.add('hc-good')
        setTimeout(() => { element.classList.remove('hc-good') }, PLAY_STEP_DELAY)
      }
      if ('done' in currentStep)
        currentStep.done()
      element.state.lastStep = currentStepIndex
      return element.state
    }

    function repaintRubberband(to) {
      let svg = arena.nextSibling
      let items = svg.getElementsByClassName('rubberband')
      if (items.length > 0) svg.removeChild(items[0])

      if (pointerStarted) {
        let rubberband = drawPointer(currentStep.source, to)
        rubberband.classList.add('rubberband')
        svg.appendChild(rubberband)
        resize();
      }
    }

    const initArena = () => {
      elements = []
      pointers = new Map()

      let container = null
      if (arena) { // start over
        container = arena.parentNode
        arena.innerHTML = ''
        let svg = arena.nextSibling
        svg.innerHTML = ''
      }
      else {
        container = document.createElement('div')
        element.appendChild(container)
        container.classList.add('arenaContainer')
        arena = document.createElement('div')
        arena.style.position = 'absolute' // TODO in CSS? (validator)
        container.appendChild(arena)
        let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.style.width = '100%' // Doesn't work in CSS
        svg.style.height = '100%'
        svg.style.zIndex = '2'
        svg.style.position = 'absolute'
        svg.style.pointerEvents = 'none'
        container.appendChild(svg)

        let mousemoveListener = function(e) {
          if (pointerStarted) {
            //e.preventDefault()
            e.stopPropagation()
            let outerRect = container.getBoundingClientRect()
            repaintRubberband({
              x: pxToEm(e.pageX - outerRect.left - window.scrollX),
              y: pxToEm(e.pageY - outerRect.top - window.scrollY),
              width: 0,
              height: 0
            })
          }
        }
        arena.addEventListener('mousemove', mousemoveListener)
        /*
        arena.addEventListener('touchmove', mousemoveListener, {passive: true})
        */
      }
    }

    /*
      Prepares the visual appearance for the next interactive step
    */
    const prepareNextStep = () => {
      getNextStep()
      if (currentStep === undefined) {
        commonUI.done(doneAction => {
          initState(element.state)
          setTimeout(() => {
            playSteps(doneAction)
          }, PLAY_STEP_DELAY)
        })
        return
      }
      const prompt = currentStep.prompt || ''
      if (currentStep.type === 'next') {
        commonUI.instruction(prompt, {
          nextAction: () => {
            doStep()
            setTimeout(prepareNextStep, SHOW_STEP_DELAY)
          },
        })
      } else if (currentStep.type === 'pause') {
        commonUI.instruction(prompt)
        setTimeout(prepareNextStep, SHOW_STEP_DELAY)
      } else if (currentStep.type === 'input') {
        if (currentStep.element === undefined) {
          commonUI.instruction(prompt)
          editStarted(undefined)
        } else if (currentStep.select) {
          commonUI.instruction(prompt, {
            secondary: 'Select the value to be updated', // TODO: i18n
          })
        } else {
          commonUI.instruction(prompt)
          editStarted(currentStep.element)          
        }
      } else { // TODO if 'select', activate the right tab group
        commonUI.instruction(prompt)
      }
    }

    const countSteps = (data) => {
      sim.silent = true
      stepIter = algo(sim, data)
      currentStep = undefined
      currentStepIndex = -1
      let steps = 0
      let done = false
      let maxscore = 0
      let startFound = false
      let stateData
      while (!done) {
        getNextStep()
        if (currentStep === undefined) done = true
        else {
          steps++
          if (!['start', 'next', 'pause'].includes(currentStep.type))
            maxscore++
          else if (currentStep.type === 'start' && steps === 1) {
            startFound = true
            stateData = currentStep.state
          }
          if ('done' in currentStep) currentStep.done()
        }
      }
      sim.silent = false
      return { maxscore, startFound, stateData, steps }
    }

    const initState = from => {
      element.state = {
        data: from === null || from === undefined ? undefined : from.data,
        lastStep: -1
      }
      let { maxscore, startFound, stateData, steps } = countSteps(element.state.data)
      element.state.data = stateData
      initArena()
      stepIter = algo(sim, element.state.data)
      if (startFound || steps === 0) getNextStep()
      currentStep = undefined
      currentStepIndex = -1
      return maxscore
    }

    const getNextStep = () => {
      let nextStep = stepIter.next(currentStepResult)

      if (!nextStep.done &&
          (typeof nextStep.value !== 'object' ||
           !('type' in nextStep.value) ||
           !['input', 'select', 'pause', 'next', 'start', 'connect', 'click'].includes(nextStep.value.type)))
        alert('Unexpected step ' + JSON.stringify(nextStep))
      if (currentStepIndex != -1 && nextStep.value === 'start')
        alert('Unexpected start ' + JSON.stringify(nextStep))
      currentStep = nextStep.done ? undefined : nextStep.value
      currentStepIndex++
      currentStepResult = undefined
    }

    const restoreState = state => {
      let maxscore = initState(state)
      if (state && (state.correct > 0 || state.errors > 0)) {
        // Play the first steps
        while (currentStepIndex < state.lastStep) {
          getNextStep()
          doStep()
        }
        prepareNextStep() // Prepare the UI for the next step (or show Good Job!)
      }
      return maxscore
    }

    // Start of initElement
    let { steps } = countSteps(undefined)

    commonUI = horstmann_common.uiInit(element, prepareNextStep, {
      ...config,
      interactive: true,
      retainMarkers: ['hc-good'],
      hideStart: steps === 0
    })
    commonUI.restore(restoreState)
  }

  // Start of event listener
  const elements = [...document.getElementsByClassName('codecheck_tracer')]
  while (elements.length < setup.length) {
    const element = document.createElement('div')
    element.classList.add('codecheck_tracer')
    elements.push(element)
    document.getElementsByTagName('body')[0].appendChild(element)
  }
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index]
    const id = 'codecheck_tracer' + (index + 1)
    element.id = id
    initElement(element, id, setup[index])
  }
})
