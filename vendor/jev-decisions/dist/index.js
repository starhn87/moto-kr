// @ts-self-types="./index.d.ts"

// src/index.ts
import { APIError, APIConnectionError, APITimeoutError, APIUserAbortError, TypeSafeError } from "@typesafe-ai/sdk";
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
var sameKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
var tokenCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
var sameJson = (expected, value) => {
  if (expected === value) return true;
  if (Array.isArray(expected) && Array.isArray(value)) return expected.length === value.length && expected.every((item, i) => sameJson(item, value[i]));
  return record(expected) && record(value) && sameKeys(value, Object.keys(expected)) && Object.keys(expected).every((key) => sameJson(expected[key], value[key]));
};
function validateAnswers(questions, value) {
  const issues = [];
  const issue = (path, code) => {
    issues.push({ path, code });
  };
  if (!Object.keys(questions).length) return { ok: false, issues: [{ path: [], code: "invalid_question" }] };
  if (!record(value)) return { ok: false, issues: [{ path: [], code: "invalid_answers" }] };
  if (Object.keys(value).some((id) => !Object.hasOwn(questions, id))) issue([], "unexpected_answer");
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(value, id)) {
      issue([id], "missing_answer");
      continue;
    }
    const answer = value[id];
    if (!record(answer) || answer.type !== question.type) {
      issue([id, "type"], "invalid_answer_type");
      continue;
    }
    if (question.type === "noul") {
      if (!probability(answer.noul)) issue([id, "noul"], "invalid_probability");
      continue;
    }
    if (question.type !== "choice" && question.type !== "score" || question.type === "choice" && (!record(question.criteria) || !Object.keys(question.criteria).length) || question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
      issue([id], "invalid_question");
      continue;
    }
    if (!probability(answer.confidence)) issue([id, "confidence"], "invalid_confidence");
    const keys = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
    if (!record(answer.probabilities) || !sameKeys(answer.probabilities, keys)) {
      issue([id, "probabilities"], "invalid_probabilities");
      continue;
    }
    const probs = keys.map((key) => answer.probabilities[key]);
    keys.forEach((key, i) => {
      if (!probability(probs[i])) issue([id, "probabilities", key], "invalid_probability");
    });
    if (!probs.every(probability)) continue;
    if (Math.abs(probs.reduce((sum, p) => sum + p, 0) - 1) > keys.length * 5e-3 + 1e-8) issue([id, "probabilities"], "invalid_probability_sum");
    if (question.type === "choice") {
      if (typeof answer.choice !== "string" || !keys.includes(answer.choice)) issue([id, "choice"], "invalid_choice");
      else if (answer.probabilities[answer.choice] !== Math.max(...probs)) issue([id, "choice"], "choice_probability_mismatch");
    } else {
      if (!record(answer.legend) || !sameKeys(answer.legend, keys) || !keys.every((key, i) => sameJson(question.criteria[i], answer.legend[key]))) issue([id, "legend"], "invalid_legend");
      if (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1) {
        issue([id, "score"], "invalid_score");
        continue;
      }
      const expected = probs.reduce((sum, p, i) => sum + p * i, 0);
      const tolerance = 5e-3 + keys.reduce((sum, _, i) => sum + i * 5e-3, 0);
      if (Math.abs(expected - answer.score) > tolerance + 1e-8) issue([id, "score"], "score_probability_mismatch");
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, answers: value };
}
function toObservation(questions, outcome, context = {}) {
  const meta = {
    definitionId: context.definitionId ?? null,
    definitionVersion: context.definitionVersion ?? null,
    requestedModel: context.requestedModel ?? null,
    durationMs: typeof context.durationMs === "number" && Number.isFinite(context.durationMs) && context.durationMs >= 0 ? context.durationMs : null,
    model: null,
    requestId: null,
    inputTokens: null,
    outputTokens: null
  };
  if ("error" in outcome) {
    const error = outcome.error;
    if (error instanceof APIError) meta.requestId = error.requestId ?? null;
    const details = error instanceof APIUserAbortError ? { kind: "aborted" } : error instanceof APITimeoutError ? { kind: "timeout" } : error instanceof APIError ? { kind: "http", status: error.status } : error instanceof APIConnectionError ? { kind: "network" } : error instanceof TypeSafeError ? { kind: "invalid_request" } : { kind: "unknown" };
    return { ok: false, error: details, meta };
  }
  meta.requestId = outcome.requestId ?? null;
  const raw = outcome.data;
  if (record(raw)) {
    meta.model = typeof raw.model === "string" ? raw.model : null;
    if (record(raw.usage)) {
      meta.inputTokens = tokenCount(raw.usage.input_tokens);
      meta.outputTokens = tokenCount(raw.usage.output_tokens);
    }
  }
  const checked = validateAnswers(questions, record(raw) ? raw.answers : void 0);
  return checked.ok ? { ok: true, answers: checked.answers, meta } : { ok: false, error: { kind: "invalid_response", issues: checked.issues }, meta };
}
async function observe({ questions, run, context = {} }) {
  const started = performance.now();
  let outcome;
  try {
    outcome = await run();
  } catch (error) {
    outcome = { error };
  }
  const result = toObservation(questions, outcome, context);
  return { ...result, meta: { ...result.meta, durationMs: performance.now() - started } };
}
export {
  observe,
  toObservation,
  validateAnswers
};
