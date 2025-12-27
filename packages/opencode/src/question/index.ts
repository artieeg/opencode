import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"

export namespace Question {
  const log = Log.create({ service: "question" })

  export const Option = z
    .object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
    })
    .meta({ ref: "QuestionOption" })
  export type Option = z.infer<typeof Option>

  export const Item = z
    .object({
      id: z.string(),
      text: z.string(),
      description: z.string().optional(),
      options: z.array(Option).optional(),
      allowCustom: z.boolean().default(true),
      required: z.boolean().default(false),
      multiSelect: z.boolean().default(false),
    })
    .meta({ ref: "QuestionItem" })
  export type Item = z.infer<typeof Item>

  export const Answer = z
    .object({
      questionID: z.string(),
      selectedOptions: z.array(z.string()).optional(),
      customValue: z.string().optional(),
      skipped: z.boolean().default(false),
    })
    .meta({ ref: "QuestionAnswer" })
  export type Answer = z.infer<typeof Answer>

  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      messageID: z.string(),
      callID: z.string().optional(),
      title: z.string().optional(),
      questions: z.array(Item),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({ ref: "Question" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Asked: BusEvent.define("question.asked", Info),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: z.string(),
        questionID: z.string(),
        answers: z.array(Answer),
        cancelled: z.boolean().default(false),
      }),
    ),
  }

  const state = Instance.state(
    () => {
      const pending: {
        [sessionID: string]: {
          [questionID: string]: {
            info: Info
            resolve: (answers: Answer[]) => void
            reject: (e: any) => void
          }
        }
      } = {}

      return { pending }
    },
    async (state) => {
      for (const pending of Object.values(state.pending)) {
        for (const item of Object.values(pending)) {
          item.reject(new CancelledError(item.info.sessionID, item.info.id))
        }
      }
    },
  )

  export function pending() {
    return state().pending
  }

  export function list(sessionID: string): Info[] {
    const { pending } = state()
    const session = pending[sessionID]
    if (!session) return []
    return Object.values(session).map((x) => x.info)
  }

  export async function ask(input: {
    sessionID: string
    messageID: string
    callID?: string
    title?: string
    questions: Item[]
  }): Promise<Answer[]> {
    const { pending } = state()
    log.info("asking", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      questionCount: input.questions.length,
    })

    const info: Info = {
      id: Identifier.ascending("question"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      title: input.title,
      questions: input.questions,
      time: {
        created: Date.now(),
      },
    }

    pending[input.sessionID] = pending[input.sessionID] || {}

    return new Promise<Answer[]>((resolve, reject) => {
      pending[input.sessionID][info.id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Asked, info)
    })
  }

  export function addQuestions(input: { sessionID: string; questionID: string; questions: Item[] }) {
    const { pending } = state()
    const match = pending[input.sessionID]?.[input.questionID]
    if (!match) return false

    match.info.questions.push(...input.questions)
    Bus.publish(Event.Asked, match.info)
    return true
  }

  export const Response = z.object({
    answers: z.array(Answer),
    cancelled: z.boolean().default(false),
  })
  export type Response = z.infer<typeof Response>

  export function respond(input: { sessionID: string; questionID: string; response: Response }) {
    log.info("response", input)
    const { pending } = state()
    const match = pending[input.sessionID]?.[input.questionID]
    if (!match) return

    delete pending[input.sessionID][input.questionID]
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      questionID: input.questionID,
      answers: input.response.answers,
      cancelled: input.response.cancelled,
    })

    if (input.response.cancelled) {
      match.reject(new CancelledError(input.sessionID, input.questionID))
      return
    }

    match.resolve(input.response.answers)
  }

  export class CancelledError extends Error {
    constructor(
      public readonly sessionID: string,
      public readonly questionID: string,
    ) {
      super("User cancelled the question form")
    }
  }
}
