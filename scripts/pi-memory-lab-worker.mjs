// Lab worker: one OS process hosting the unmodified pi-memory module.
// All storage env is set by the parent at spawn, before upstream is imported here.
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {applyAdapterPolicy} from './pi-memory-lab-adapter.mjs';

const LAB_BASE_PROMPT = 'LAB_BASE_PROMPT: deterministic fixture session.';
const sessions = new Map();
let upstream;
let sdk;

const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const textOf = result => (result?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
const normalize = (name, result, isError) => ({
  name,
  isError: !!(isError || result?.isError),
  text: textOf(result),
  details: plain(result?.details),
});

function memoryCredentials() {
  const values = new Map();
  return {
    read: async provider => values.get(provider),
    list: async () => [],
    modify: async (provider, update) => {
      const value = await update(values.get(provider));
      if (value) values.set(provider, value);
      else values.delete(provider);
      return value;
    },
    delete: async provider => {
      values.delete(provider);
    },
  };
}

// Observes registrations without altering upstream code. Handlers are retained so lifecycle
// paths with no SDK trigger here can be invoked directly (labelled direct-handler).
function observe(pi, state) {
  return new Proxy(pi, {
    get(target, key) {
      if (key === 'on') {
        return (event, handler) => {
          (state.handlers[event] ??= []).push(handler);
          return target.on(event, async (payload, ctx) => {
            state.ctx = ctx;
            state.fired[event] = (state.fired[event] || 0) + 1;
            return handler(payload, ctx);
          });
        };
      }
      if (key === 'registerTool') {
        return definition => {
          state.tools.set(definition.name, definition);
          return target.registerTool(definition);
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function openSdk(state, {cwd, agentDir, fixtureBaseUrl, tools, policy}) {
  sdk ??= await import('@earendil-works/pi-coding-agent');
  const {createAgentSession, SessionManager, ModelRuntime, DefaultResourceLoader, SettingsManager} = sdk;
  const modelRuntime = await ModelRuntime.create({credentials: memoryCredentials(), modelsPath: null, refreshOnCreate: false});
  modelRuntime.registerProvider('lab-fixture', {
    baseUrl: fixtureBaseUrl,
    apiKey: 'fixture-not-a-secret',
    api: 'openai-completions',
    models: [{id: 'lab-fixture-1', name: 'lab-fixture-1', reasoning: false, input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 200000, maxTokens: 4096}],
  });
  const model = modelRuntime.getModel('lab-fixture', 'lab-fixture-1');
  if (!model) throw new Error('Fixture model not registered');
  const settingsManager = SettingsManager.inMemory({cacheWarming: 'off', retry: {enabled: false}, compaction: {enabled: false}});
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: LAB_BASE_PROMPT,
    extensionFactories: [
      pi => {
        upstream.default(observe(pi, state));
        if (policy) applyAdapterPolicy(pi, policy);
      },
    ],
  });
  await resourceLoader.reload();
  const {session} = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    model,
    thinkingLevel: 'off',
    tools,
  });
  state.session = session;
  state.extensionErrors = [];
  // session_start is only dispatched once extensions are bound (docs/sdk.md:116).
  if (typeof session.bindExtensions === 'function') {
    await session.bindExtensions({onError: error => state.extensionErrors.push(String(error?.error ?? error?.message ?? error))});
    state.bound = true;
  }
  return {
    transport: 'sdk',
    activeTools: session.getActiveToolNames?.() ?? null,
    bound: !!state.bound,
    sessionStartFired: state.fired.session_start || 0,
    extensionErrors: state.extensionErrors,
  };
}

async function openCore(state, {sessionId, policy}) {
  if (policy) throw new Error('Adapter hooks need a real SDK session');
  upstream.default({
    on: (event, handler) => {
      (state.handlers[event] ??= []).push(handler);
    },
    registerTool: definition => state.tools.set(definition.name, definition),
  });
  state.ctx = {
    hasUI: false,
    sessionManager: {getSessionId: () => sessionId, getBranch: () => []},
    modelRegistry: {},
    model: undefined,
  };
  for (const handler of state.handlers.session_start || []) await handler({type: 'session_start'}, state.ctx);
  return {transport: 'core', activeTools: [...state.tools.keys()], bound: false, sessionStartFired: 1, extensionErrors: []};
}

const ops = {
  dates: () => ({today: upstream.todayStr(), yesterday: upstream.yesterdayStr()}),
  // Upstream's test seam. Used only to demonstrate unsafe same-process sharing.
  setBaseDir: ({dir}) => {
    upstream._setBaseDir(dir);
    return {dir};
  },
  open: async args => {
    const sessionId = args.sessionId || randomUUID();
    const state = {id: sessionId, transport: args.transport, handlers: {}, fired: {}, tools: new Map(), ctx: undefined};
    sessions.set(sessionId, state);
    const info = args.transport === 'core' ? await openCore(state, {...args, sessionId}) : await openSdk(state, args);
    return {sessionId, ...info};
  },
  turn: async ({sessionId, prompt, toolName, args}) => {
    const state = sessions.get(sessionId);
    if (state.transport === 'core') {
      if (toolName) {
        const definition = state.tools.get(toolName);
        const result = await definition.execute(`core-${randomUUID()}`, args, undefined, undefined, state.ctx);
        return {tools: [normalize(toolName, result)], stopReason: 'core-probe'};
      }
      let systemPrompt = LAB_BASE_PROMPT;
      for (const handler of state.handlers.before_agent_start || []) {
        const result = await handler({type: 'before_agent_start', prompt, systemPrompt}, state.ctx);
        if (result?.systemPrompt) systemPrompt = result.systemPrompt;
      }
      return {tools: [], stopReason: 'core-probe', injected: systemPrompt};
    }
    const calls = [];
    const unsubscribe = state.session.subscribe(event => {
      if (event.type === 'tool_execution_end') calls.push(normalize(event.toolName, event.result, event.isError));
    });
    try {
      await state.session.prompt(prompt);
    } finally {
      unsubscribe();
    }
    const last = [...state.session.messages].reverse().find(message => message.role === 'assistant');
    return {tools: calls, stopReason: last?.stopReason, errorMessage: last?.errorMessage, sessionSystemPrompt: state.session.systemPrompt};
  },
  // Invokes the real upstream handler with the context captured from the real session.
  emit: async ({sessionId, event, payload}) => {
    const state = sessions.get(sessionId);
    if (!state.ctx) throw new Error(`No captured context for ${event}`);
    const results = [];
    for (const handler of state.handlers[event] || []) results.push(plain(await handler({type: event, ...payload}, state.ctx)));
    return {handlers: results.length};
  },
  close: async ({sessionId}) => {
    const state = sessions.get(sessionId);
    if (state?.session) state.session.dispose();
    sessions.delete(sessionId);
    return {shutdownFiredByDispose: state?.fired.session_shutdown || 0};
  },
  exit: () => {
    setTimeout(() => process.exit(0), 10);
    return {};
  },
};

process.on('message', async ({id, op, args}) => {
  try {
    process.send({id, ok: true, result: plain(await ops[op](args || {})) ?? null});
  } catch (error) {
    process.send({id, ok: false, error: String(error?.stack || error)});
  }
});

try {
  upstream = await import(pathToFileURL(process.env.PML_UPSTREAM_INDEX).href);
  process.send({type: 'ready'});
} catch (error) {
  process.send({type: 'fatal', error: String(error?.stack || error)});
}
