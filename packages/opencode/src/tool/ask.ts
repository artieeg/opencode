import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./ask.txt"

export const AskTool = Tool.define("ask", {
  description: DESCRIPTION,
  parameters: z.object({
    title: z.string().optional().describe("Overall title for the question set"),
    questions: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for this question"),
          text: z.string().describe("The question to ask"),
          description: z.string().optional().describe("Additional context or explanation"),
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
                description: z.string().optional(),
              }),
            )
            .optional()
            .describe("Predefined options for the user to choose from"),
          allowCustom: z.boolean().default(true).describe("Allow free-form text input"),
          required: z.boolean().default(false).describe("Whether the question must be answered"),
          multiSelect: z.boolean().default(false).describe("Allow selecting multiple options"),
        }),
      )
      .min(1)
      .describe("List of questions to ask"),
  }),
  async execute(params, ctx) {
    ctx.metadata({
      title: `Asking ${params.questions.length} question(s)...`,
      metadata: {
        title: params.title,
        questions: params.questions,
        pending: true,
      },
    })

    let answers: Question.Answer[]
    try {
      answers = await Question.ask({
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.title,
        questions: params.questions,
      })
    } catch (e) {
      if (e instanceof Question.CancelledError) {
        return {
          title: "Questions cancelled",
          output: "The user cancelled the question form. You may ask again or proceed with alternative approaches.",
          metadata: {
            title: params.title,
            questions: params.questions,
            cancelled: true,
          },
        }
      }
      throw e
    }

    const formatted = answers
      .map((a) => {
        const q = params.questions.find((q) => q.id === a.questionID)
        if (!q) return null
        if (a.skipped) return `Q: ${q.text}\nA: [Skipped]`

        const parts: string[] = []
        if (a.selectedOptions?.length) {
          const selected = a.selectedOptions.map((id) => q.options?.find((o) => o.id === id)?.label).filter(Boolean)
          parts.push(`Selected: ${selected.join(", ")}`)
        }
        if (a.customValue) {
          parts.push(`Custom input: ${a.customValue}`)
        }
        return `Q: ${q.text}\nA: ${parts.join("\n   ") || "[No answer provided]"}`
      })
      .filter(Boolean)
      .join("\n\n")

    return {
      title: `Asked ${params.questions.length} question(s)`,
      output: formatted || "No answers provided",
      metadata: {
        title: params.title,
        questions: params.questions,
        answers,
      },
    }
  },
})
