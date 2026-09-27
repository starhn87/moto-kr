import type { DecisionClient } from "./types.d.ts";
export type * from "./types.d.ts";
export { validateAnswers } from "./validation.d.ts";
export declare function createDecisionClient(config: {
    apiKey: string;
    model: string;
    baseURL?: string;
    fetch?: typeof fetch;
    maxRequestBytes?: number;
}): DecisionClient;
