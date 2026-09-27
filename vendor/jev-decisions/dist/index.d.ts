import type { Questions, SystemOneResult, WithResponse } from '@typesafe-ai/sdk';
export type ValidationIssueCode = 'invalid_answers' | 'missing_answer' | 'unexpected_answer' | 'invalid_question' | 'invalid_answer_type' | 'invalid_confidence' | 'invalid_probabilities' | 'invalid_probability' | 'invalid_probability_sum' | 'invalid_choice' | 'choice_probability_mismatch' | 'invalid_legend' | 'invalid_score' | 'score_probability_mismatch';
export type ValidationIssue = {
    path: readonly (string | number)[];
    code: ValidationIssueCode;
};
export type ValidationResult<Q extends Questions> = {
    ok: true;
    answers: SystemOneResult<Q>['answers'];
} | {
    ok: false;
    issues: readonly ValidationIssue[];
};
export type ObservationContext = {
    definitionId?: string;
    definitionVersion?: string;
    requestedModel?: string;
    durationMs?: number;
};
export type ObservationMeta = {
    definitionId: string | null;
    definitionVersion: string | null;
    requestedModel: string | null;
    durationMs: number | null;
    model: string | null;
    requestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
};
export type ObservationError = {
    kind: 'invalid_response';
    issues: readonly ValidationIssue[];
} | {
    kind: 'http';
    status: number;
} | {
    kind: 'invalid_request' | 'timeout' | 'aborted' | 'network' | 'unknown';
};
export type DecisionObservation<Q extends Questions> = {
    ok: true;
    answers: SystemOneResult<Q>['answers'];
    meta: ObservationMeta;
} | {
    ok: false;
    error: ObservationError;
    meta: ObservationMeta;
};
export declare function validateAnswers<const Q extends Questions>(questions: Q, value: unknown): ValidationResult<Q>;
export declare function toObservation<const Q extends Questions>(questions: Q, outcome: {
    data: unknown;
    requestId?: string | null;
} | {
    error: unknown;
}, context?: ObservationContext): DecisionObservation<Q>;
export declare function observe<const Q extends Questions>({ questions, run, context }: {
    questions: Q;
    run: () => PromiseLike<WithResponse<SystemOneResult<Q>>>;
    context?: Omit<ObservationContext, 'durationMs'>;
}): Promise<DecisionObservation<Q> & {
    meta: ObservationMeta & {
        durationMs: number;
    };
}>;
