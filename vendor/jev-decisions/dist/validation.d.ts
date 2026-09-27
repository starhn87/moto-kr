import type { Answers, Questions } from "./types.d.ts";
export declare const record: (value: unknown) => value is Record<string, unknown>;
export declare function validQuestions(value: unknown): value is Questions;
export declare function validateAnswers<const Q extends Questions>(questions: Q, value: unknown): Answers<Q> | null;
