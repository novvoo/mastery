import React from 'react';
import {
  assessPromptRisk,
  createRunNarrative,
  deriveInteractionStages,
  getComposerAssistText,
  getToolActivitySummary,
} from '../../app/interaction/interaction-model.js';
import {
  getAnimationMode,
  getMotionClassNames,
  getStageMotionClass,
} from '../../app/interaction/animation-system.js';
import { styles } from '../../app/styles.js';

function getStageStyle(state) {
  if (state === 'active') {return styles.interactionStageActive;}
  if (state === 'done') {return styles.interactionStageDone;}
  if (state === 'attention') {return styles.interactionStageAttention;}
  if (state === 'error') {return styles.interactionStageError;}
  return {};
}

export function InteractionConsole({ status, messages, tools, inputNotice, inputValue }) {
  const stages = deriveInteractionStages({ status, messages });
  const toolSummary = getToolActivitySummary(messages);
  const risk = assessPromptRisk(inputValue);
  const narrative = createRunNarrative({ status, messages });
  const assistText = getComposerAssistText({ status, value: inputValue, notice: inputNotice });
  const motionMode = getAnimationMode({
    status,
    messages,
    riskLevel: risk.level,
    notice: inputNotice,
  });
  const activeStage = stages.find(stage => ['active', 'attention', 'error'].includes(stage.state))
    || [...stages].reverse().find(stage => stage.state === 'done')
    || stages[0];
  const hasPrompt = Boolean(inputValue?.trim());
  const hasActiveRun = messages.length > 0 && !['idle', 'ready', 'completed'].includes(status);
  const shouldShow = messages.length > 0
    || hasPrompt
    || hasActiveRun
    || (Boolean(inputNotice) && hasPrompt)
    || (risk.level !== 'low' && hasPrompt);

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      className={getMotionClassNames(motionMode)}
      style={styles.interactionConsole}
      aria-label="interaction-console"
    >
      <div style={styles.interactionMetaRow}>
        <span
          className={getStageMotionClass(activeStage?.state)}
          style={{
            ...styles.interactionStage,
            ...getStageStyle(activeStage?.state),
          }}
          title={activeStage ? `${activeStage.label}: ${activeStage.detail}` : ''}
        >
          <span className="interactionStageDot" style={styles.interactionStageDot} />
          <span style={styles.interactionStageLabel}>{activeStage?.label || status}</span>
        </span>
        {status !== 'idle' && toolSummary.latestTool && (
          <span style={styles.interactionMetaPill}>{toolSummary.latestTool}</span>
        )}
        {hasPrompt && status !== 'running' && risk.level !== 'low' && (
          <span
            style={{
              ...styles.interactionRiskPill,
              ...(risk.level === 'high' ? styles.interactionRiskHigh : {}),
              ...(risk.level === 'medium' ? styles.interactionRiskMedium : {}),
            }}
            title={risk.reasons.join(', ')}
          >
            {risk.label}
          </span>
        )}
        <span style={styles.interactionRunNarrative}>{narrative}</span>
        {assistText && inputNotice && (
          <span
            style={{
              ...styles.interactionAssistText,
              ...(inputNotice?.tone === 'warning' ? styles.interactionAssistWarning : {}),
            }}
          >
            {assistText}
          </span>
        )}
      </div>
    </div>
  );
}
