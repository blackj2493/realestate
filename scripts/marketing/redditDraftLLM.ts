/**
 * Draft a reply from the ACTUAL thread, not from a category template.
 *
 * WHY THIS REPLACED TEMPLATES: the monitor picks one of seven category buckets
 * and, with templates, handed you that bucket's canned answer. That is right only
 * when the thread happens to be the archetypal question for its category, and
 * noise the rest of the time — which is most of the time. Two real examples from
 * one sweep: a thread asking how to factor property condition into a FIRE
 * timeline got a draft about MPAC assessments and pulling comps; a thread asking
 * people to gauge the loss on a specific listing got a draft explaining where to
 * find sold prices, on a sub that exists because everyone there already knows.
 * Neither was a wording problem, and no amount of rewriting fixes it — a template
 * cannot read the thread.
 *
 * WHAT THIS DOES NOT FIX: it still cannot look up a number. The model is told to
 * leave an explicit placeholder rather than invent a figure, because a
 * hallucinated market statistic posted under a licensed realtor's name is the
 * worst failure available here — worse than a bland reply, worse than no reply.
 *
 * SKIPPING IS A SUCCESS. Most threads do not need us. The model is asked to
 * return skip=true whenever it has nothing genuinely useful to add, and a skipped
 * alert still arrives with the thread and the reason — the finding is the value,
 * the draft is a convenience.
 *
 * TWO TRANSPORTS, SAME PROMPT. With ANTHROPIC_API_KEY set this calls the Messages
 * API. Without one it drives the local Claude Code CLI in headless mode, which
 * authenticates against the Claude Max subscription already being paid for — same
 * model, no second bill. The CLI path is the normal one here; see
 * redditDraftCLI.ts for the flags that make it behave like a plain model call.
 * Both build the identical prompt and share finalize(), so the warmup contract
 * and the numbers rule cannot hold on one path and lapse on the other.
 *
 * Falls back to the template draft on any failure: a worse draft beats a lost
 * lead, and the alert must go out either way.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ScoredItem } from './redditMonitorCore';
import type { SubredditConfig } from './redditMonitorConfig';
import { resolveClaudeCli, runClaudeCli } from './redditDraftCLI';

/**
 * Opus 5 rather than a cheaper tier: this runs a handful of times an hour on
 * short inputs, so the spend is negligible, and the whole point of the rewrite is
 * judgment about what is worth saying. `effort: medium` because the task is a
 * short piece of writing, not deep reasoning — Opus 5 is strong at medium and it
 * keeps latency inside the sweep.
 */
const MODEL = 'claude-opus-5';
const EFFORT = 'medium';
const MAX_TOKENS = 2000;

/** One thread's worth of input is small; this only guards a pathological post. */
const MAX_BODY_CHARS = 4000;

/**
 * Which transport will run.
 *
 * The API key wins when present because it is faster (~3s against ~8s) and takes
 * a real structured-output request rather than a subprocess. The CLI is the
 * default in practice: it runs on the Claude Max seat that is already paid for,
 * so drafting costs rate limit rather than a second invoice. See redditDraftCLI.ts.
 */
export type DraftTransport = 'api' | 'cli' | 'none';

export function draftTransport(): DraftTransport {
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  if (resolveClaudeCli()) return 'cli';
  return 'none';
}

export function draftLLMConfigured(): boolean {
  return draftTransport() !== 'none';
}

const HOUSE_STYLE = `
Write like a person who knows the subject, not like a brand.

- Two to four sentences. Long replies read as marketing whoever wrote them.
- Contractions. Lowercase sentence starts are fine. Fragments are fine.
- No em-dashes, no bullet lists, no bold, no headings. All of them read as generated.
- Answer ONE thing well rather than covering every angle. Completeness is the
  single biggest tell that nobody wrote it.
- Have an opinion. Hedging everything reads as fake.
- No sign-off, no "hope this helps", no "great question".
- Never restate the question back at them.
`.trim();

const NUMBERS_RULE = `
You have NO access to live market data. Never state a specific statistic, price,
percentage, or median as fact — you will be wrong and it will be posted under a
licensed realtor's name.

If the reply genuinely needs a figure, write a bracketed placeholder in caps
saying exactly what to look up, e.g. [CHECK THE CURRENT BRAMPTON OVER-ASK RATE].
A draft that looks unfinished is correct; a draft with an invented number is not.

Do NOT build a sentence around a placeholder that asserts a trend you made up —
"around [X]% of sales close in the fall" is still a fabricated claim, it just
hides the number. If a point only works with a statistic you do not have, make a
different point instead.

General, non-numeric domain knowledge is fine — how VOW rules work, what a status
certificate is, what the FHSA affects.
`.trim();

export interface DraftResult {
  draft: string;
  skip: boolean;
  reason: string;
  /** True when the API failed and the caller should keep its template draft. */
  failed?: boolean;
}

const SCHEMA = {
  type: 'object',
  properties: {
    skip: {
      type: 'boolean',
      description: 'true when there is nothing genuinely useful to add to this thread',
    },
    reason: {
      type: 'string',
      description: 'One short sentence: why this is worth replying to, or why it is not.',
    },
    draft: {
      type: 'string',
      description: 'The reply, or an empty string when skip is true.',
    },
  },
  required: ['skip', 'reason', 'draft'],
  additionalProperties: false,
} as const;

/** Exported for tests: the safety-critical parts of this prompt are worth asserting. */
export function buildPrompt(
  item: ScoredItem,
  sub: SubredditConfig | undefined,
  warmup: boolean,
): string {
  const body = item.body.trim().slice(0, MAX_BODY_CHARS);

  const promoRule = warmup
    ? `WARMUP MODE IS ON. Do NOT name PureProperty, do NOT include any URL, and do
NOT add a disclosure — there is nothing to disclose when you are not promoting
anything. Just be useful. This is non-negotiable and the draft is discarded if it
names the site.`
    : `You may mention pureproperty.ca if — and only if — the thread is genuinely
asking for a tool or a data source. Never inject it into a discussion that did not
ask. If you mention it, end with a plain disclosure in parentheses, e.g.
"(i work on pureproperty)".`;

  return [
    `You are drafting a Reddit reply for a licensed Ontario realtor who runs a
housing-data site. The draft goes to them for review — they edit and post it
themselves, so write the reply itself, not advice about what to write.`,
    '',
    `## The thread`,
    `Subreddit: r/${item.subreddit}`,
    `Title: ${item.title}`,
    body ? `Body:\n${body}` : '(no body text)',
    '',
    `## Sub rules of engagement`,
    sub?.note ?? 'Unlisted sub — assume strict rules on self-promotion.',
    sub?.compliance ? `\nHARD CONSTRAINT — this changes what may be said:\n${sub.compliance}` : '',
    '',
    `## Promotion`,
    promoRule,
    '',
    `## Numbers`,
    NUMBERS_RULE,
    '',
    `## Style`,
    HOUSE_STYLE,
    '',
    `## Decide first, then write`,
    `Most threads do not need a reply from this person. Set skip=true unless they
can add something the thread does not already have — a correction, a distinction
people are missing, or knowledge that actually changes what the asker should do.
Set skip=true for: pure venting, threads where the top comments already cover it,
anything needing a live figure you cannot supply AND nothing else to say, and
anything where replying would just be an advert.

If you do reply, answer what was actually asked. Do not pivot to a topic you would
rather discuss.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Replaces Claude Code's own system prompt on the CLI path. Deliberately terse:
 * the instructions all live in the user turn (buildPrompt) so both transports
 * send the same words to the same model, and the prompt tests cover both.
 */
const CLI_SYSTEM_PROMPT =
  'You draft Reddit replies for a licensed Ontario realtor to review before posting. ' +
  'Follow the instructions in the message exactly. Return only the JSON object.';

/**
 * Validate and post-process a model response. Shared by both transports so the
 * warmup contract cannot hold on one path and not the other.
 */
function finalize(raw: unknown, warmup: boolean, fallback: string): DraftResult {
  if (!raw || typeof raw !== 'object') {
    return { draft: fallback, skip: false, reason: 'draft was not an object', failed: true };
  }
  const r = raw as { skip?: unknown; reason?: unknown; draft?: unknown };
  const draft = typeof r.draft === 'string' ? r.draft.trim() : '';
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  const skip = r.skip === true;

  // Enforced here as well as in the prompt and again in the sender: a model can
  // ignore an instruction, and a draft that names the site during warmup must
  // never reach the phone looking postable.
  if (warmup && /pureproperty|https?:\/\//i.test(draft)) {
    return {
      draft: '[draft discarded — model named the site during warmup. Write this one yourself.]',
      skip: false,
      reason: 'warmup violation in generated draft',
      failed: true,
    };
  }

  // An empty draft with skip=false is a malformed response, not a judgement.
  if (!skip && !draft) {
    return { draft: fallback, skip: false, reason: reason || 'model returned an empty draft', failed: true };
  }

  return { draft, skip, reason };
}

async function draftViaApi(prompt: string, warmup: boolean, fallback: string): Promise<DraftResult> {
  const client = new Anthropic();
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: EFFORT,
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    });

    if (res.stop_reason === 'refusal') {
      return { draft: fallback, skip: false, reason: 'model declined to draft', failed: true };
    }

    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return { draft: fallback, skip: false, reason: 'no text block returned', failed: true };
    }

    return finalize(JSON.parse(text.text), warmup, fallback);
  } catch (e) {
    return {
      draft: fallback,
      skip: false,
      reason: `draft API failed: ${e instanceof Error ? e.message : String(e)}`,
      failed: true,
    };
  }
}

async function draftViaCli(prompt: string, warmup: boolean, fallback: string): Promise<DraftResult> {
  const res = await runClaudeCli(prompt, SCHEMA, MODEL, EFFORT, CLI_SYSTEM_PROMPT);
  if (!res.ok) return { draft: fallback, skip: false, reason: `draft CLI failed: ${res.error}`, failed: true };
  return finalize(res.data, warmup, fallback);
}

/**
 * Generate one draft. Never throws — a failure returns the caller's fallback with
 * failed=true, because losing the alert is worse than shipping a weaker draft.
 */
export async function draftReply(
  item: ScoredItem,
  sub: SubredditConfig | undefined,
  warmup: boolean,
  fallback: string,
): Promise<DraftResult> {
  const prompt = buildPrompt(item, sub, warmup);
  switch (draftTransport()) {
    case 'api':
      return draftViaApi(prompt, warmup, fallback);
    case 'cli':
      return draftViaCli(prompt, warmup, fallback);
    default:
      return { draft: fallback, skip: false, reason: 'no draft transport available', failed: true };
  }
}
