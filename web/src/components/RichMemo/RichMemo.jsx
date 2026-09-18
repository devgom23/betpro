import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  charsToRuns, memoClass, parseMemo, runsToChars, serializeRuns, stripMemo,
} from '../../utils/richMemo'
import './RichMemo.css'

// 메모 한 줄 입력칸 — 글자를 드래그해 고르면 위에 🖍(형광펜)·S(취소줄)·U(물결 밑줄) 버튼이 뜬다
// (2026-09-15 사용자 지정). 저장값은 utils/richMemo.js의 표시 기호 글자.
//
// 일반 <input> 대신 contentEditable 칸이다. 한글 조합 중에 칸 내용을 다시 그리면 커서가
// 튀므로, 다시 그리는 건 ① 바깥 값이 실제로 달라졌을 때 ② 꾸밈 버튼을 눌렀을 때뿐이다.
// 타이핑은 브라우저에 맡기고, 저장할 때만 칸 안의 글자·꾸밈을 읽어 기호 글자로 바꾼다.

function renderInto(el, markup) {
  el.textContent = ''
  for (const run of parseMemo(markup)) {
    const cls = memoClass(run)
    if (!cls) {
      el.appendChild(document.createTextNode(run.text))
    } else {
      const span = document.createElement('span')
      span.className = cls
      span.textContent = run.text
      el.appendChild(span)
    }
  }
}

// 칸 안의 글자를 읽는다. 브라우저가 타이핑하면서 붙인 인라인 스타일(글자 이어 쓰기 때
// 크롬이 옆 글자 모양을 style로 복사하는 경우)도 같은 꾸밈으로 본다.
function readRuns(el) {
  const chars = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let hl = false
    let st = false
    let ul = false
    for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
      if (p.classList.contains('memo-ul') || p.tagName === 'U') ul = true
      if (p.classList.contains('memo-hl') || p.tagName === 'MARK') hl = true
      if (p.classList.contains('memo-st') || ['S', 'STRIKE', 'DEL'].includes(p.tagName)) st = true
      const bg = p.style?.backgroundColor
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') hl = true
      if ((p.style?.textDecoration || p.style?.textDecorationLine || '').includes('line-through')) st = true
      if ((p.style?.textDecoration || p.style?.textDecorationLine || '').includes('underline')) ul = true
    }
    const text = node.data.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ')
    for (const c of text.split('')) chars.push({ c, hl, st, ul })
  }
  return charsToRuns(chars)
}

function selectionOffsets(el) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
  const measure = (container, offset) => {
    const pre = document.createRange()
    pre.selectNodeContents(el)
    pre.setEnd(container, offset)
    return pre.toString().length
  }
  return { start: measure(range.startContainer, range.startOffset), end: measure(range.endContainer, range.endOffset) }
}

function setSelectionOffsets(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startPoint = null
  let endPoint = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.data.length
    if (!startPoint && start <= pos + len) startPoint = [node, start - pos]
    if (!endPoint && end <= pos + len) { endPoint = [node, end - pos]; break }
    pos += len
  }
  if (!startPoint || !endPoint) return
  const range = document.createRange()
  range.setStart(...startPoint)
  range.setEnd(...endPoint)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

export function RichMemoInput({ value, placeholder, onChange, onCommit, onEnter, className = '', id, title }) {
  const ref = useRef(null)
  const [empty, setEmpty] = useState(!stripMemo(value))
  const [toolbar, setToolbar] = useState(null)

  // 바깥 값이 칸 내용과 다를 때만 다시 그린다(타이핑 중 onChange로 올려 보낸 값은 같으니 안 건드림).
  useLayoutEffect(() => {
    const el = ref.current
    const v = value || ''
    if (serializeRuns(readRuns(el)) === v) return
    renderInto(el, v)
    setEmpty(!stripMemo(v))
  }, [value])

  useEffect(() => {
    function onSelectionChange() {
      const el = ref.current
      if (!el || document.activeElement !== el) {
        setToolbar(null)
        return
      }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !el.contains(sel.anchorNode)) {
        setToolbar(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setToolbar({ left: rect.left + rect.width / 2, top: rect.top })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const current = () => serializeRuns(readRuns(ref.current))

  function toggle(attr) {
    const el = ref.current
    const off = selectionOffsets(el)
    if (!off || off.start === off.end) return
    const chars = runsToChars(readRuns(el))
    const part = chars.slice(off.start, off.end)
    const on = !part.every((ch) => ch[attr])
    for (let i = off.start; i < off.end && i < chars.length; i += 1) chars[i][attr] = on
    const markup = serializeRuns(charsToRuns(chars))
    renderInto(el, markup)
    setSelectionOffsets(el, off.start, off.end)
    onChange?.(markup)
  }

  function handleInput() {
    const el = ref.current
    // 다 지우면 크롬이 <br>을 남겨서 빈 칸 안내 글자가 안 뜬다 — 비었으면 깨끗이 비운다.
    if (el.textContent === '' && el.childNodes.length) el.textContent = ''
    setEmpty(el.textContent === '')
    onChange?.(current())
  }

  function handleKeyDown(e) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (onEnter) onEnter(current())
    else ref.current.blur()
  }

  function handlePaste(e) {
    e.preventDefault()
    const text = (e.clipboardData.getData('text/plain') || '').replace(/[\r\n]+/g, ' ')
    document.execCommand('insertText', false, text)
  }

  function handleBlur() {
    setToolbar(null)
    const markup = current()
    if (markup !== (value || '')) onCommit?.(markup)
  }

  return (
    <>
      <div
        ref={ref}
        id={id}
        title={title}
        className={`rich-memo ${className}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={placeholder}
        data-placeholder={placeholder}
        data-empty={empty ? 'true' : 'false'}
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
      />
      {toolbar && createPortal(
        <div
          className="rich-memo-toolbar"
          style={{ left: toolbar.left, top: toolbar.top }}
          // 버튼을 눌러도 칸의 선택이 풀리지 않게 한다.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" className="rich-memo-btn rich-memo-btn-hl" title="형광펜" onClick={() => toggle('hl')}>🖍</button>
          <button type="button" className="rich-memo-btn rich-memo-btn-st" title="취소줄" onClick={() => toggle('st')}>S</button>
          <button type="button" className="rich-memo-btn rich-memo-btn-ul" title="물결 밑줄" onClick={() => toggle('ul')}>U</button>
        </div>,
        document.body,
      )}
    </>
  )
}

// 표시 전용 — 목록 등에서 메모를 꾸밈 그대로 보여준다.
export function RichMemoText({ value }) {
  return (
    <>
      {parseMemo(value).map((run, i) => {
        const cls = memoClass(run)
        return cls ? <span key={i} className={cls}>{run.text}</span> : <span key={i}>{run.text}</span>
      })}
    </>
  )
}
