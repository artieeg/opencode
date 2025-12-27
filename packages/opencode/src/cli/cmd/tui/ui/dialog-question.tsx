import { TextareaRenderable, TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { batch, createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useDialog, type DialogContext } from "./dialog"
import type { Question } from "@/question"

export interface DialogQuestionProps {
  info: Question.Info
  onSubmit: (answers: Question.Answer[]) => void
  onCancel: () => void
}

export function DialogQuestion(props: DialogQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  const [store, setStore] = createStore({
    currentIndex: 0,
    selectedOption: 0,
    inputMode: false,
    customInput: "",
    answers: {} as Record<string, Question.Answer>,
  })

  const questions = () => props.info.questions
  const current = () => questions()[store.currentIndex]
  const hasOptions = () => (current()?.options?.length ?? 0) > 0
  const total = () => questions().length

  let textarea: TextareaRenderable
  let scroll: ScrollBoxRenderable

  onMount(() => {
    dialog.setSize("large")
  })

  createEffect(
    on(
      () => store.currentIndex,
      () => {
        setStore("selectedOption", 0)
        setStore("customInput", "")
        if (scroll) scroll.scrollTo(0)
      },
    ),
  )

  function isOptionSelected(optionId: string) {
    const answer = store.answers[current()?.id ?? ""]
    return answer?.selectedOptions?.includes(optionId) ?? false
  }

  function selectOption(optionId: string) {
    const q = current()
    if (!q) return

    // Check if this option is already selected (for submit-on-reselect logic)
    const alreadySelected = isOptionSelected(optionId)

    if (alreadySelected && !q.multiSelect) {
      // Option already selected, submit the form
      submitAll()
      return
    }

    setStore("answers", q.id, (prev) => {
      const existing = prev ?? { questionID: q.id, selectedOptions: [], skipped: false }
      const selected = existing.selectedOptions ?? []

      if (q.multiSelect) {
        const newSelected = selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId]
        return { ...existing, selectedOptions: newSelected }
      }

      return { ...existing, selectedOptions: [optionId] }
    })
  }

  function saveCustomInput() {
    const q = current()
    if (!q) return
    // Read directly from textarea to get the latest value
    const value = textarea?.plainText ?? store.customInput
    if (!value) return
    setStore("answers", q.id, (prev) => {
      const existing = prev ?? { questionID: q.id, skipped: false }
      return { ...existing, customValue: value }
    })
  }

  function skipQuestion() {
    const q = current()
    if (!q || q.required) return
    setStore("answers", q.id, { questionID: q.id, skipped: true })
    if (store.currentIndex < total() - 1) {
      setStore("currentIndex", store.currentIndex + 1)
    }
  }

  function submitAll() {
    const result = questions().map((q) => store.answers[q.id] ?? { questionID: q.id, skipped: !q.required })
    props.onSubmit(result)
    dialog.clear()
  }

  function handleCancel() {
    props.onCancel()
    dialog.clear()
  }

  useKeyboard((evt) => {
    // In input mode, only handle specific exit keys
    if (store.inputMode) {
      if (evt.name === "up" || evt.name === "down") {
        evt.preventDefault()
        saveCustomInput()
        setStore("inputMode", false)
        textarea?.blur()
        if (hasOptions()) {
          if (evt.name === "up") {
            setStore("selectedOption", Math.max(0, store.selectedOption - 1))
          } else {
            const max = (current()?.options?.length ?? 1) - 1
            setStore("selectedOption", Math.min(max, store.selectedOption + 1))
          }
          scrollToOption()
        }
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        saveCustomInput()
        setStore("inputMode", false)
        textarea?.blur()
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        // Sync the textarea value to store before saving
        const value = textarea?.plainText?.trim()
        if (value) {
          setStore("customInput", value)
          const q = current()
          if (q) {
            setStore("answers", q.id, (prev) => {
              const existing = prev ?? { questionID: q.id, skipped: false }
              return { ...existing, customValue: value }
            })
          }
        }
        setStore("inputMode", false)
        textarea?.blur()
        // Move to next question, or submit if last question
        if (store.currentIndex < total() - 1) {
          setStore("currentIndex", store.currentIndex + 1)
        } else {
          submitAll()
        }
        return
      }
      // Let all other keys go to the textarea (including tab, space, left, right, etc.)
      return
    }

    // Not in input mode - prevent default for navigation keys
    if (["up", "down", "left", "right", "tab", "return", "escape", "space"].includes(evt.name)) {
      evt.preventDefault()
    }

    if (evt.name === "escape") {
      handleCancel()
      return
    }

    if (evt.name === "left" || (evt.ctrl && evt.name === "h")) {
      if (store.currentIndex > 0) {
        setStore("currentIndex", store.currentIndex - 1)
      }
      return
    }

    if (evt.name === "right" || (evt.ctrl && evt.name === "l")) {
      if (store.currentIndex < total() - 1) {
        setStore("currentIndex", store.currentIndex + 1)
      }
      return
    }

    if (evt.name === "up" || evt.name === "k") {
      if (hasOptions()) {
        setStore("selectedOption", Math.max(0, store.selectedOption - 1))
        scrollToOption()
      }
      return
    }

    if (evt.name === "down" || evt.name === "j") {
      if (hasOptions()) {
        const max = (current()?.options?.length ?? 1) - 1
        setStore("selectedOption", Math.min(max, store.selectedOption + 1))
        scrollToOption()
      }
      return
    }

    if (evt.name === "return" || evt.name === "space") {
      if (hasOptions()) {
        const option = current()?.options?.[store.selectedOption]
        if (option) selectOption(option.id)
      } else {
        // No options, just submit
        submitAll()
      }
      return
    }

    if (evt.name === "tab" && current()?.allowCustom !== false) {
      setStore("inputMode", true)
      setTimeout(() => textarea?.focus(), 1)
      return
    }

    if (evt.name === "s" && !current()?.required && !evt.ctrl && !evt.meta) {
      skipQuestion()
      return
    }

    // Submit with cmd+enter, ctrl+enter, or cmd/ctrl+s
    if ((evt.meta || evt.ctrl) && (evt.name === "return" || evt.name === "s")) {
      evt.preventDefault()
      submitAll()
      return
    }
  })

  function scrollToOption() {
    if (!scroll) return
    const target = scroll.getChildren().find((child) => child.id === `option-${store.selectedOption}`)
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
    }
  }

  const currentAnswer = createMemo(() => store.answers[current()?.id ?? ""])
  const answeredCount = createMemo(() => Object.keys(store.answers).length)
  const requiredAnswered = createMemo(() => {
    return questions()
      .filter((q) => q.required)
      .every((q) => {
        const ans = store.answers[q.id]
        return ans && !ans.skipped && ((ans.selectedOptions?.length ?? 0) > 0 || ans.customValue)
      })
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.info.title ?? "Questions"}
          </text>
          <text fg={theme.textMuted}>
            {store.currentIndex + 1}/{total()}
            {store.currentIndex > 0 && " ◀"}
            {store.currentIndex < total() - 1 && " ▶"}
          </text>
        </box>
      </box>

      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {current()?.text}
          {current()?.required && <span style={{ fg: theme.error }}> *</span>}
        </text>
        <Show when={current()?.description}>
          <text fg={theme.textMuted}>{current()?.description}</text>
        </Show>
      </box>

      <Show when={hasOptions()}>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          paddingLeft={2}
          paddingRight={2}
          maxHeight={8}
          scrollbarOptions={{ visible: false }}
        >
          <For each={current()?.options}>
            {(option, i) => {
              const isSelected = () => currentAnswer()?.selectedOptions?.includes(option.id)
              const isFocused = () => store.selectedOption === i()

              return (
                <box
                  id={`option-${i()}`}
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={isFocused() ? theme.backgroundElement : undefined}
                  onMouseUp={() => selectOption(option.id)}
                  onMouseOver={() => setStore("selectedOption", i())}
                >
                  <text fg={isFocused() ? theme.primary : theme.text}>{isSelected() ? "●" : "○"}</text>
                  <box flexDirection="column">
                    <text
                      fg={isFocused() ? theme.primary : theme.text}
                      attributes={isFocused() ? TextAttributes.BOLD : undefined}
                    >
                      {option.label}
                    </text>
                    <Show when={option.description}>
                      <text fg={theme.textMuted}>{option.description}</text>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>

      <Show when={current()?.allowCustom !== false}>
        <box paddingLeft={2} paddingRight={2}>
          <text fg={theme.textMuted}>Custom answer:</text>
          <textarea
            ref={(r: TextareaRenderable) => (textarea = r)}
            height={2}
            initialValue={store.customInput}
            onInput={(e) => setStore("customInput", e)}
            onFocus={() => setStore("inputMode", true)}
            onBlur={() => {
              saveCustomInput()
              setStore("inputMode", false)
            }}
            placeholder="Type custom answer..."
            textColor={store.inputMode ? theme.text : theme.textMuted}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
            backgroundColor={store.inputMode ? theme.backgroundElement : undefined}
            focusedBackgroundColor={theme.backgroundElement}
          />
        </box>
      </Show>

      <box paddingLeft={2} paddingRight={2} paddingTop={1} borderStyle="single" borderTop borderDimColor gap={1}>
        <box flexDirection="row" gap={2} flexWrap="wrap">
          <text>
            <span style={{ fg: theme.text, bold: true }}>↑/↓</span>
            <span style={{ fg: theme.textMuted }}> navigate</span>
          </text>
          <text>
            <span style={{ fg: theme.text, bold: true }}>enter</span>
            <span style={{ fg: theme.textMuted }}> select/submit</span>
          </text>
          <Show when={current()?.allowCustom !== false}>
            <text>
              <span style={{ fg: theme.text, bold: true }}>tab</span>
              <span style={{ fg: theme.textMuted }}> custom</span>
            </text>
          </Show>
          <Show when={!current()?.required}>
            <text>
              <span style={{ fg: theme.text, bold: true }}>s</span>
              <span style={{ fg: theme.textMuted }}> skip</span>
            </text>
          </Show>
          <text>
            <span style={{ fg: theme.text, bold: true }}>←/→</span>
            <span style={{ fg: theme.textMuted }}> questions</span>
          </text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>
            {answeredCount()}/{total()} answered
          </text>
          <box flexDirection="row" gap={2}>
            <box paddingLeft={1} paddingRight={1} onMouseUp={handleCancel} backgroundColor={theme.backgroundElement}>
              <text fg={theme.textMuted}>Cancel</text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={submitAll}
              backgroundColor={requiredAnswered() ? theme.primary : theme.backgroundElement}
            >
              <text fg={requiredAnswered() ? fg : theme.textMuted}>Submit</text>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}
