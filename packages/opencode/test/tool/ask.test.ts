import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Question } from "../../src/question"
import { AskTool } from "../../src/tool/ask"

describe("Ask Tool", () => {
  test("tool is defined with correct id", async () => {
    const tool = await AskTool.init()
    expect(tool.description).toContain("clarifying questions")
  })

  test("Question.ask creates pending question", async () => {
    // Simulate a question being asked (don't await - it blocks)
    const askPromise = Question.ask({
      sessionID: "test-session",
      messageID: "test-message",
      callID: "test-call",
      title: "Test Questions",
      questions: [
        {
          id: "q1",
          text: "Which option?",
          options: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
          allowCustom: true,
          required: false,
          multiSelect: false,
        },
      ],
    })

    // Check pending state
    const pending = Question.list("test-session")
    expect(pending.length).toBe(1)
    expect(pending[0].title).toBe("Test Questions")
    expect(pending[0].questions.length).toBe(1)

    // Respond to the question
    Question.respond({
      sessionID: "test-session",
      questionID: pending[0].id,
      response: {
        answers: [{ questionID: "q1", selectedOptions: ["a"], skipped: false }],
        cancelled: false,
      },
    })

    // Now the promise should resolve
    const answers = await askPromise
    expect(answers.length).toBe(1)
    expect(answers[0].selectedOptions).toEqual(["a"])
  })

  test("Question cancellation throws CancelledError", async () => {
    const askPromise = Question.ask({
      sessionID: "test-session-2",
      messageID: "test-message-2",
      questions: [{ id: "q1", text: "Test?", allowCustom: true, required: false, multiSelect: false }],
    })

    const pending = Question.list("test-session-2")
    Question.respond({
      sessionID: "test-session-2",
      questionID: pending[0].id,
      response: { answers: [], cancelled: true },
    })

    await expect(askPromise).rejects.toThrow(Question.CancelledError)
  })
})
