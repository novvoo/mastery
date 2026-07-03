import { useState, useCallback } from 'react';
import { LLM_PROVIDER_OPTIONS } from '../app/config/index.js';

export function useModelConfig(ipc) {
  const [llmConfigStatus, setLLMConfigStatus] = useState(null);
  const [showLLMSetup, setShowLLMSetup] = useState(false);
  const [llmForm, setLLMForm] = useState({
    provider: 'openai',
    apiKey: '',
    model: LLM_PROVIDER_OPTIONS.openai.defaultModel,
    baseUrl: LLM_PROVIDER_OPTIONS.openai.defaultBaseUrl,
  });
  const [llmSetupError, setLLMSetupError] = useState('');
  const [llmSetupSaving, setLLMSetupSaving] = useState(false);
  const [modelConfigs, setModelConfigs] = useState([]);
  const [toggleModelError, setToggleModelError] = useState(null);
  const [toggleModelSuccess, setToggleModelSuccess] = useState(null);

  const handleLLMProviderChange = useCallback((provider) => {
    const option = LLM_PROVIDER_OPTIONS[provider] || LLM_PROVIDER_OPTIONS.openai;
    setLLMSetupError('');
    setLLMForm((prev) => ({
      ...prev,
      provider,
      model: option.defaultModel,
      baseUrl: option.defaultBaseUrl,
    }));
  }, []);

  const handleLLMFormChange = useCallback((key, value) => {
    setLLMSetupError('');
    setLLMForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const handleSaveLLMConfig = useCallback(async () => {
    if (!llmForm.apiKey.trim()) {
      const keyLabel = LLM_PROVIDER_OPTIONS[llmForm.provider]?.keyLabel || 'API Key';
      setLLMSetupError(`${keyLabel} 不能为空`);
      return;
    }

    if (!llmForm.model.trim()) {
      setLLMSetupError('模型名称不能为空');
      return;
    }

    setLLMSetupSaving(true);
    setLLMSetupError('');

    try {
      const result = await ipc.saveLLMConfig(llmForm);
      if (!result?.success) {
        setLLMSetupError(result?.error || '保存 LLM 配置失败');
        if (result?.status) {
          setLLMConfigStatus(result.status);
        }
        return;
      }

      setLLMConfigStatus(result.status);
      setShowLLMSetup(false);
      setLLMForm((prev) => ({ ...prev, apiKey: '' }));
    } catch (error) {
      setLLMSetupError(error.message || '保存 LLM 配置失败');
    } finally {
      setLLMSetupSaving(false);
    }
  }, [ipc, llmForm]);

  const handleAddModel = useCallback((config) => {
    setModelConfigs((prev) => [...prev, config]);
  }, []);

  const handleUpdateModel = useCallback((id, updated) => {
    setModelConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
  }, []);

  const handleDeleteModel = useCallback((id) => {
    setModelConfigs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleToggleModel = useCallback(
    async (id) => {
      try {
        setToggleModelError(null);
        setToggleModelSuccess(null);
        const config = modelConfigs.find((c) => c.id === id);
        if (!config) return;

        const previousConfigs = modelConfigs;
        const newEnabled = !config.enabled;

        if (newEnabled) {
          setModelConfigs((prev) =>
            prev.map((c) => ({
              ...c,
              enabled: c.id === id ? true : false,
            })),
          );
        } else {
          if (config.enabled) {
            setToggleModelError('不能禁用当前激活的模型，请先启用其他模型');
            return;
          }
          setModelConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: false } : c)));
        }

        const result = await ipc.toggleModel(id, newEnabled);

        if (!result.success) {
          setToggleModelError(result.error || '操作失败');
          setModelConfigs(previousConfigs);
        } else {
          if (Array.isArray(result.configs)) {
            setModelConfigs(result.configs);
          }
          if (result.provider && result.model) {
            setToggleModelSuccess(
              `✅ 已切换到 ${result.provider}:${result.model}，配置已同步到 .env`,
            );
            setTimeout(() => setToggleModelSuccess(null), 3000);
          }
        }
      } catch (error) {
        setToggleModelError(error.message);
        setModelConfigs(modelConfigs);
      }
    },
    [ipc, modelConfigs],
  );

  return {
    llmConfigStatus,
    setLLMConfigStatus,
    showLLMSetup,
    setShowLLMSetup,
    llmForm,
    setLLMForm,
    llmSetupError,
    setLLMSetupError,
    llmSetupSaving,
    setLLMSetupSaving,
    modelConfigs,
    setModelConfigs,
    toggleModelError,
    toggleModelSuccess,
    handleLLMProviderChange,
    handleLLMFormChange,
    handleSaveLLMConfig,
    handleAddModel,
    handleUpdateModel,
    handleDeleteModel,
    handleToggleModel,
  };
}
