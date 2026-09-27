import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
export type ObservationContext = {
    definitionId: string;
    definitionVersion: string;
    requestedModel: string;
    durationMs: number;
};
export type ObservationMeta = ObservationContext & {
    model: string | null;
    requestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
};
export type ObservationError = {
    kind: 'invalid_request' | 'invalid_response' | 'timeout' | 'aborted' | 'network' | 'http' | 'unknown';
    status?: number;
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
export declare function validateAnswers<const Q extends Questions>(questions: Q, value: unknown): SystemOneResult<Q>['answers'] | null;
export declare function toObservation<const Q extends Questions>(questions: Q, outcome: {
    data: unknown;
    requestId?: string | null;
} | {
    error: unknown;
}, context: ObservationContext): DecisionObservation<Q>;
