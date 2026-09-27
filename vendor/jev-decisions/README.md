# Jev response utilities

Use the official `@typesafe-ai/sdk` for requests, question builders, types, cancellation and retry settings. This package adds two synchronous response utilities. It does not make requests, read API keys, select models or save observations. SDK 0.6.0 is a peer dependency, not a bundled SDK copy.

## Install in an existing project

From a Jev Utils clone, `npm run connect -- ../my-app` installs the official SDK, these utilities, a local CLI and project skills. See [exact installation scope](https://github.com/starhn87/jev-utils/blob/main/docs/integration.md).

For library-only installation, copy `artifacts/starhn87-jev-decisions-0.2.1.tgz` from the clone to your project's vendor folder, then install that local package and `@typesafe-ai/sdk@0.6.0` using your package manager. Commit the vendor file, manifest and lockfile. npm registry publication is pending.

## Validate an official SDK response

Inside your existing TypeScript server code:

```ts
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { validateAnswers } from '@starhn87/jev-decisions';

const client = new TypeSafeClient({ apiKey, retry: { maxRetries: 0 } });
const questions = {
  kind: choice('What is this inquiry about?', {
    account: 'Account settings or login',
    other: 'Other inquiries',
  }),
};
const response = await client.systemOne({ state: { message }, questions }, {
  timeout: 1200,
  signal,
});
const answers = validateAnswers(questions, response.answers);
if (answers) console.log(answers.kind.choice); // "account" | "other"
```

`validateAnswers(questions, value)` returns the official SDK answer type or `null`. It checks question IDs, answer kinds, allowed labels, probability keys/ranges/sums, the selected maximum, and Score values/legends. Probability rounding is tolerated. It preserves the SDK's supported single-option Choice question. Format validation does not establish task accuracy.

## Convert a result for observations

When an app needs a shared record format, pass the result of `.withResponse()` or a caught SDK error to `toObservation`:

```ts
import { toObservation } from '@starhn87/jev-decisions';

const started = performance.now();
let outcome;
try {
  outcome = await client.systemOne({ state: { message }, questions }, {
    timeout: 1200, signal,
  }).withResponse();
} catch (error) {
  outcome = { error };
}
const observation = toObservation(questions, outcome, {
  definitionId: 'inquiry-kind', definitionVersion: '1',
  requestedModel: client.defaultModel,
  durationMs: performance.now() - started,
});
```

This validates the answers and returns `ok`, answers or a classified error, and allowlisted metadata. Definition ID/version, actual/requested model, request ID, duration and available token usage use a common format. Missing or invalid usage is `null`, not zero. Exception messages and request content are not copied. SDK errors are classified as `invalid_request`, `timeout`, `aborted`, `network` or `http`; invalid answers are `invalid_response`; other exceptions are `unknown`.

Each app chooses its questions, request limits, timeout/retry settings, thresholds, fallback behavior, storage and background lifetime. No public client wrapper, policy engine or automatic Shadow instrumentation is included.

## Workers and Deno

Workers use the same imports through the application's bundler. Deno/Supabase can map `@typesafe-ai/sdk` to `npm:@typesafe-ai/sdk@0.6.0` in their Deno configuration and import the vendored utility's `dist/index.js`. Its adjacent `index.d.ts` uses the official SDK types. Keep the SDK version and lockfile in the app's execution environment. [Runtime verification and release procedure](https://github.com/starhn87/jev-utils/blob/main/docs/releases.md).
