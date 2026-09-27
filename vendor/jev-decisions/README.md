# Jev Decisions

Web API-only ESM package for Workers, Deno and Node. The official TypeSafe SDK 0.6.0 is bundled; this package has no external runtime imports. Consumers supply secrets, a pinned model and their own question definitions.

`createDecisionClient({ apiKey, model, baseURL?, fetch? }).decide({ definitionId, definitionVersion, state, questions }, { signal?, timeoutMs? })` returns validated answers or a classified error. Default deadline is 1200ms, retries are disabled. Definition metadata stays local. No request bodies, secrets, storage or domain actions are logged or executed.

Choice/Score probabilities must match the question's keys. Rounded probability sums and score expectations are checked with per-entry rounding tolerance. Low certainty is a valid answer, not a transport error. Missing usage remains null.

Each application owns thresholds, abstention, actions and background lifetime. An aborted user request must not start fallback work. These protocol guarantees do not establish semantic accuracy; calibrate each Korean task before enforcement.
