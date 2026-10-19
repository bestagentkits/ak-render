/**
 * Live model clients for the A/B harness.
 *
 * Two wire formats cover the providers the harness supports: Anthropic
 * Messages, and OpenAI-compatible chat completions (OpenAI, OpenRouter). Both
 * are reduced to one shape so the agent loop does not branch on provider:
 *
 *   turn(messages) -> { text, toolCalls: [{ id, name, args }], usage, truncated, retries, retryMs }
 *
 * `messages` is the provider-neutral conversation:
 *   { role: 'user', text }
 *   { role: 'assistant', text, toolCalls }
 *   { role: 'tool', results: [{ id, name, text, isError }] }
 *
 * Token counts come from the provider's own usage report, never an estimate.
 */

const PROVIDERS = {
  anthropic: { env: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', wire: 'anthropic' },
  openrouter: {
    env: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    wire: 'openai',
  },
  openai: { env: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', wire: 'openai' },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * The provider to use: the one asked for, or the first whose key is set.
 * Returns `{ name, apiKey }`, or `{ name, skip }` explaining why no run is possible.
 */
export function resolveProvider(requested, env = process.env) {
  const names = requested === undefined ? PROVIDER_NAMES : [requested];
  for (const name of names) {
    const provider = PROVIDERS[name];
    if (provider === undefined) throw new Error(`unknown provider: ${name}`);
    const apiKey = env[provider.env];
    if (apiKey) return { name, apiKey };
  }
  const keys = names.map((name) => PROVIDERS[name].env).join(', ');
  return { name: requested, skip: `no model API key: set one of ${keys}` };
}

const MAX_ATTEMPTS = 4;
/** A turn the provider answered without a usage report: never counted as zero tokens. */
const MISSING_USAGE = Object.freeze({ input: 0, output: 0, cost: undefined, missing: true });
const REQUEST_TIMEOUT_MS = 180_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Key-shaped strings an error body might echo back, masked or not. */
const SECRET = /\b(sk|pk|rk|key)[-_][A-Za-z0-9_\-.*]{6,}/gu;
export const redact = (text) => text.replace(SECRET, '[redacted]');

/**
 * POST with retries on 429, 5xx and network errors. `retryMs` is the time lost
 * to provider failures: every failed attempt plus the back-off after it.
 */
async function postJson(url, headers, body) {
  let retries = 0;
  let retryMs = 0;
  const backOff = async (attempt) => {
    retries += 1;
    const ms = 2000 * 2 ** (attempt - 1);
    retryMs += ms;
    await sleep(ms);
  };
  for (let attempt = 1; ; attempt += 1) {
    const attemptStarted = performance.now();
    const failed = () => {
      retryMs += performance.now() - attemptStarted;
    };
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      failed();
      await backOff(attempt);
      continue;
    }
    if (response.ok) return { json: await response.json(), retries, retryMs: Math.round(retryMs) };
    // Error bodies end up in the committed report, so keep them short and keyless.
    const detail = redact((await response.text()).slice(0, 300));
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`model request failed: HTTP ${response.status}: ${detail}`);
    }
    failed();
    await backOff(attempt);
  }
}

function parseArguments(raw) {
  if (raw === undefined || raw === '') return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' ? value : { _raw: raw };
  } catch {
    // A model that emits malformed tool arguments is a real failure of the
    // run; pass the text through so the server reports it.
    return { _raw: raw };
  }
}

/** The neutral conversation as Anthropic Messages turns. */
export function anthropicMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.text };
    if (message.role === 'assistant') {
      const content = [];
      if (message.text) content.push({ type: 'text', text: message.text });
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      return { role: 'assistant', content };
    }
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.id,
        content: result.text,
        is_error: result.isError,
      })),
    };
  });
}

/** The neutral conversation as OpenAI-compatible chat messages, system prompt first. */
export function openAiMessages(system, messages) {
  const wire = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') wire.push({ role: 'user', content: message.text });
    else if (message.role === 'assistant') {
      wire.push({
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length === 0
          ? {}
          : {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }),
      });
    } else {
      for (const result of message.results) {
        wire.push({ role: 'tool', tool_call_id: result.id, content: result.text });
      }
    }
  }
  return wire;
}

function anthropicClient({ apiKey, baseUrl, model, maxTokens, temperature, system, tools }) {
  const toolDefs = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
  return async (messages) => {
    const { json, retries, retryMs } = await postJson(
      `${baseUrl}/v1/messages`,
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: maxTokens,
        system,
        tools: toolDefs,
        messages: anthropicMessages(messages),
        ...(temperature === undefined ? {} : { temperature }),
      },
    );
    const blocks = json.content ?? [];
    const usage = json.usage;
    return {
      text: blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
      toolCalls: blocks
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, args: block.input ?? {} })),
      usage:
        usage === undefined
          ? MISSING_USAGE
          : {
              input:
                (usage.input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0),
              output: usage.output_tokens ?? 0,
              cost: undefined,
            },
      truncated: json.stop_reason === 'max_tokens',
      retries,
      retryMs,
    };
  };
}

function openAiClient({ apiKey, baseUrl, model, maxTokens, temperature, system, tools, name }) {
  const toolDefs = tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
  return async (messages) => {
    const { json, retries, retryMs } = await postJson(
      `${baseUrl}/chat/completions`,
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        // OpenAI's current models reject max_tokens; OpenRouter accepts either.
        ...(name === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        tools: toolDefs,
        messages: openAiMessages(system, messages),
        ...(temperature === undefined ? {} : { temperature }),
        // OpenRouter reports the billed cost of the call when asked.
        ...(name === 'openrouter' ? { usage: { include: true } } : {}),
      },
    );
    if (json.error) {
      throw new Error(`model request failed: ${redact(JSON.stringify(json.error).slice(0, 300))}`);
    }
    const choice = json.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const usage = json.usage;
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function?.name,
        args: parseArguments(call.function?.arguments),
      })),
      usage:
        usage === undefined
          ? MISSING_USAGE
          : {
              input: usage.prompt_tokens ?? 0,
              output: usage.completion_tokens ?? 0,
              cost: Number.isFinite(usage.cost) ? usage.cost : undefined,
            },
      truncated: choice.finish_reason === 'length',
      retries,
      retryMs,
    };
  };
}

/** A `turn(messages)` function for one provider, model, system prompt and tool set. */
export function createModelClient({ provider, apiKey, baseUrl, ...options }) {
  const definition = PROVIDERS[provider];
  const settings = { apiKey, baseUrl: baseUrl ?? definition.baseUrl, name: provider, ...options };
  return definition.wire === 'anthropic' ? anthropicClient(settings) : openAiClient(settings);
}
