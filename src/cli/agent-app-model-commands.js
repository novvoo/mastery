import { select, input } from '@inquirer/prompts';
import {
  assertSupportedProvider,
  createModelProviderForSwitch,
} from './model-provider-factory.js';
import { enhancedUI } from './enhanced-ui.js';

export async function handleModelCommand(agent, args) {
  if (!args || args === 'list') {
    showCurrentModel(agent);
    return;
  }

  if (args === 'switch' || args === 'change') {
    await interactiveModelSwitch(agent);
    return;
  }

  const parts = args.split(':');
  if (parts.length === 2) {
    const [provider, model] = parts;
    await switchModel(agent, provider.trim(), model.trim());
    return;
  }

  await switchModel(agent, agent.config.provider, args.trim());
}

export function showCurrentModel(agent) {
  console.log(enhancedUI.createHeader('Current Model'));

  const table = enhancedUI.createTable({
    colWidths: [20, 50],
  });

  table.push(
    [enhancedUI.theme.primaryBold('Provider'), agent.config.provider],
    [enhancedUI.theme.primaryBold('Model'), agent.config.model],
    [enhancedUI.theme.primaryBold('Temperature'), agent.config.temperature],
    [enhancedUI.theme.primaryBold('Max Iterations'), agent.config.maxIterations],
  );

  console.log(table.toString());
  console.log('');
  console.log(enhancedUI.theme.dim('Use /model switch for interactive selection'));
  console.log(enhancedUI.theme.dim('Use /model <provider>:<model> to switch directly'));
  console.log(enhancedUI.theme.dim('Examples:'));
  console.log(enhancedUI.theme.dim('  /model openai:gpt-4'));
  console.log(enhancedUI.theme.dim('  /model openai:gpt-3.5-turbo'));
  console.log(enhancedUI.theme.dim('  /model zhipu:glm-4'));
  console.log(enhancedUI.theme.dim('  /model deepseek:deepseek-chat'));
  console.log(enhancedUI.theme.dim('  /model openrouter:anthropic/claude-3-opus'));
  console.log(enhancedUI.theme.dim('  /model gpt-4 (keeps current provider)'));
  console.log('');
}

export async function interactiveModelSwitch(agent) {
  const provider = await select({
    message: 'Select provider:',
    choices: [
      { name: '🔵 OpenAI', value: 'openai' },
      { name: '🦙 Llama (Local)', value: 'llama' },
      { name: '🇨🇳 Zhipu AI (智谱清言)', value: 'zhipu' },
      { name: '🔮 DeepSeek', value: 'deepseek' },
      { name: '🌐 OpenRouter', value: 'openrouter' },
    ],
    default: agent.config.provider,
  });

  const modelChoices = modelChoicesForProvider(provider);
  const model = await select({
    message: 'Select model:',
    choices: modelChoices,
    default: agent.config.model,
  });

  let finalModel = model;
  if (model === 'custom') {
    const customModel = await input({
      message: 'Enter model name:',
      validate: (value) => value.trim() !== '' || 'Model name is required',
    });
    finalModel = customModel.trim();
  }

  await switchModel(agent, provider, finalModel);
}

export async function switchModel(agent, provider, model) {
  const spinner = enhancedUI.spinner('Switching model...');
  spinner.start();

  try {
    assertSupportedProvider(provider);
    const newProvider = createModelProviderForSwitch(provider, model, {
      temperature: agent.config.temperature,
      debug: agent.debugMode,
    });

    agent.config.provider = provider;
    agent.config.model = model;
    agent.engine.attachModelProvider(newProvider);

    if (agent.schedulerEngine) {
      agent.schedulerEngine.modelProvider = newProvider;
    }

    agent.modelProvider = newProvider;

    spinner.stop();
    enhancedUI.success(`Switched to ${provider}:${model}`);
    console.log('');
  } catch (error) {
    spinner.stop();
    enhancedUI.error(`Failed to switch model: ${error.message}`);
    console.log('');
  }
}

function modelChoicesForProvider(provider) {
  if (provider === 'openai') {
    return [
      { name: 'GPT-4', value: 'gpt-4' },
      { name: 'GPT-4 Turbo', value: 'gpt-4-turbo-preview' },
      { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
      { name: 'GPT-3.5 Turbo 16k', value: 'gpt-3.5-turbo-16k' },
      { name: 'Custom...', value: 'custom' },
    ];
  }
  if (provider === 'llama') {
    return [
      { name: 'Llama 2 7B', value: 'llama-2-7b' },
      { name: 'Llama 2 13B', value: 'llama-2-13b' },
      { name: 'Llama 2 70B', value: 'llama-2-70b' },
      { name: 'Code Llama', value: 'codellama' },
      { name: 'Custom...', value: 'custom' },
    ];
  }
  if (provider === 'zhipu') {
    return [
      { name: 'GLM-4', value: 'glm-4' },
      { name: 'GLM-4V (Vision)', value: 'glm-4v' },
      { name: 'GLM-4-Flash', value: 'glm-4-flash' },
      { name: 'GLM-3-Turbo', value: 'glm-3-turbo' },
      { name: 'Custom...', value: 'custom' },
    ];
  }
  if (provider === 'deepseek') {
    return [
      { name: 'DeepSeek Chat', value: 'deepseek-chat' },
      { name: 'DeepSeek Coder', value: 'deepseek-coder' },
      { name: 'Custom...', value: 'custom' },
    ];
  }
  if (provider === 'openrouter') {
    return [
      { name: 'OpenAI GPT-4', value: 'openai/gpt-4' },
      { name: 'OpenAI GPT-4 Turbo', value: 'openai/gpt-4-turbo' },
      { name: 'OpenAI GPT-4o', value: 'openai/gpt-4o' },
      { name: 'Anthropic Claude 3 Opus', value: 'anthropic/claude-3-opus' },
      { name: 'Anthropic Claude 3 Sonnet', value: 'anthropic/claude-3-sonnet' },
      { name: 'Google Gemini Pro', value: 'google/gemini-pro' },
      { name: 'Meta Llama 3 70B', value: 'meta-llama/llama-3-70b-instruct' },
      { name: 'Mistral Large', value: 'mistralai/mistral-large' },
      { name: 'DeepSeek Chat', value: 'deepseek/deepseek-chat' },
      { name: 'Custom...', value: 'custom' },
    ];
  }
  return [{ name: 'Custom...', value: 'custom' }];
}
