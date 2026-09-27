export type Json = string | number | boolean | null | Json[] | {
    [key: string]: Json;
};
export type Entry = string | Json[] | {
    [key: string]: Json;
} | null;
export type Question = {
    type: "noul";
    instructions?: Entry;
    criteria?: {
        true?: Entry;
        false?: Entry;
    } | null;
} | {
    type: "choice";
    instructions?: Entry;
    criteria: Record<string, Entry>;
} | {
    type: "score";
    instructions?: Entry;
    criteria: readonly [Entry, Entry, ...Entry[]];
};
export type Questions = Record<string, Question>;
export type Answer<Q extends Question> = Q extends {
    type: "noul";
} ? {
    type: "noul";
    noul: number;
} : Q extends {
    type: "choice";
    criteria: infer C;
} ? {
    type: "choice";
    choice: keyof C & string;
    confidence: number;
    probabilities: Record<keyof C & string, number>;
} : {
    type: "score";
    score: number;
    confidence: number;
    probabilities: Record<string, number>;
};
export type Answers<Q extends Questions> = {
    [K in keyof Q]: Answer<Q[K]>;
};
export type DecisionRequest<Q extends Questions> = {
    definitionId: string;
    definitionVersion: string;
    state: Entry;
    questions: Q;
};
export type DecisionMeta = {
    definitionId: string;
    definitionVersion: string;
    requestedModel: string;
    model: string | null;
    requestId: string | null;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
};
export type ErrorKind = "invalid_request" | "missing_key" | "timeout" | "aborted" | "network" | "http" | "invalid_response";
export type DecisionResult<Q extends Questions> = {
    ok: true;
    answers: Answers<Q>;
    meta: DecisionMeta;
} | {
    ok: false;
    error: {
        kind: ErrorKind;
        status?: number;
    };
    meta: DecisionMeta;
};
export type DecisionOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
};
export type DecisionClient = {
    decide<const Q extends Questions>(request: DecisionRequest<Q>, options?: DecisionOptions): Promise<DecisionResult<Q>>;
};
