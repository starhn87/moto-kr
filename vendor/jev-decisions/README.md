# Jev response utilities

Use the official `@typesafe-ai/sdk` for requests, question builders, types, cancellation and retry settings. This package adds validation diagnostics and a shared observation format. SDK 0.6.0 is a peer dependency, not a bundled SDK copy. Library use requires neither a CLI nor an agent skill.

## Install in an existing project

From a Jev Utils clone, `npm run connect -- ../my-app` installs the official SDK, these utilities, a local CLI and project skills. See [exact installation scope](https://github.com/starhn87/jev-utils/blob/main/docs/integration.md).

For library-only installation, copy `artifacts/starhn87-jev-decisions-0.3.0.tgz` from the clone to your project's vendor folder, then install that local package and `@typesafe-ai/sdk@0.6.0` using your package manager. Commit the vendor file, manifest and lockfile. npm registry publication is pending.

## Observe a native SDK call

Inside your existing TypeScript server code:

```ts
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { observe } from '@starhn87/jev-decisions';

const client = new TypeSafeClient({ apiKey, retry: { maxRetries: 0 } });
const questions = {
  kind: choice('What is this inquiry about?', {
    account: 'Account settings or login',
    other: 'Other inquiries',
  }),
};
const result = await observe({
  questions,
  run: () => client.systemOne({ state: { message }, questions }, {
    timeout: 1200, signal,
  }).withResponse(),
  context: {
    definitionId: 'inquiry-kind', definitionVersion: '1',
    requestedModel: client.defaultModel,
  },
});
if (result.ok) console.log(result.answers.kind.choice); // "account" | "other"
else if (result.error.kind === 'invalid_response') console.log(result.error.issues);
else console.log(result.error.kind);
```

`observe({ questions, run, context? })` invokes `run` once, catches synchronous or asynchronous SDK failures, validates answers and measures elapsed time through validation. It preserves the native SDK answer types. It creates no client, adds no retries and saves nothing. The SDK's own retries, timeout, model, headers and cancellation remain in the supplied call. Keep input budgets, thresholds, fallback behavior, storage and background lifetime in the app.

The result is `{ ok: true, answers, meta }` or `{ ok: false, error, meta }`. `meta` contains definition ID/version, requested/resolved model, request ID, duration and input/output token counts. `context` is optional; missing metadata is `null`. Unknown usage stays distinct from actual zero. Duration uses `performance.now()` and includes SDK retries and validation, but excludes work before `observe` and later storage. A valid uncertain answer is a success; business abstention is an app policy.

## Validate answers without observation

```ts
import { validateAnswers } from '@starhn87/jev-decisions';

const response = await client.systemOne({ state: { message }, questions });
const checked = validateAnswers(questions, response.answers);
if (checked.ok) console.log(checked.answers.kind.choice);
else console.log(checked.issues);
// Example: { ok: false, issues: [{ path: ['kind', 'choice'], code: 'invalid_choice' }] }
```

`validateAnswers(questions, value)` is synchronous and performs no requests. It checks question IDs, answer kinds, allowed labels, probability keys/ranges/sums, the selected maximum, and Score values/legends. It tolerates probability rounding and preserves the SDK's single-option Choice support. Format validation does not establish task accuracy.

`issues` contains paths relative to the answers object and stable machine-readable codes. Paths contain only known question IDs and fields; rejected values, unexpected provider keys and raw content are never included. Multiple independent failures may be returned; checks that depend on malformed fields are skipped.

| Code | Meaning |
| --- | --- |
| `invalid_answers` | Answers is not an object |
| `missing_answer`, `unexpected_answer` | Missing required question ID or extra answer ID |
| `invalid_question` | Empty questions or unsupported question/criteria shape |
| `invalid_answer_type` | Answer object/type does not match the question |
| `invalid_confidence` | Confidence is not a finite number in [0, 1] |
| `invalid_probabilities`, `invalid_probability`, `invalid_probability_sum` | Distribution keys/shape, individual range or rounded sum is invalid |
| `invalid_choice`, `choice_probability_mismatch` | Selected label is not allowed or does not have maximum probability |
| `invalid_legend`, `invalid_score`, `score_probability_mismatch` | Score legend, range or probability-weighted value is inconsistent |

## Convert an already completed outcome

`toObservation(questions, outcome, context?)` is synchronous and performs no requests. Pass the existing `.withResponse()` result or `{ error }` when timing/execution is already owned by another tool. Context may include a known `durationMs`; missing or invalid duration becomes `null` rather than zero.

Both observation functions classify native SDK failures as `invalid_request`, `timeout`, `aborted`, `network` or `http` (with `status`). Invalid answers become `invalid_response` with `issues`; other exceptions become `unknown`. Exception messages, response bodies, state and extra context fields are not copied. Successful answers remain available for app policies, so select the fields your app permits when persisting observations.

## Migrating from 0.2.x

- `validateAnswers` now returns a discriminated result instead of answers or `null`. Check `checked.ok`, then use `checked.answers` or `checked.issues`.
- Replace repeated timing/try/catch/`toObservation` blocks with `observe`. Keep SDK options in `run`.
- Context is optional. Unspecified definition/model/duration fields now have explicit `null` values. Existing populated fields retain their meaning.
- Narrow `error.kind` before reading HTTP `status` or response validation `issues`.

## Workers and Deno

Workers use the same imports through the application's bundler. Deno/Supabase can map `@typesafe-ai/sdk` to `npm:@typesafe-ai/sdk@0.6.0` in their Deno configuration and import the vendored utility's `dist/index.js`. Its adjacent `index.d.ts` uses the official SDK types. Keep the SDK version and lockfile in the app's execution environment. [Runtime verification and release procedure](https://github.com/starhn87/jev-utils/blob/main/docs/releases.md).
