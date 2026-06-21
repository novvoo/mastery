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
  if (state === 'active') return styles.interactionStageActive;
  if (state === 'done') return styles.interactionStageDone;
  if (state === 'attention') return styles.interactionStageAttention;
  if (state === 'error') return styles.interactionStageError;
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
  const shouldShow = status !== 'idle'
    || Boolean(inputNotice)
    || risk.level !== 'low'
    || Boolean(inputValue?.trim())
    || messages.length > 0;

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
        {status !== 'idle' && (
          <span style={styles.interactionMetaPill}>{toolSummary.latestTool}</span>
        )}
        {tools?.length > 0 && status === 'running' && (
          <span style={styles.interactionMetaPill}>{tools.length} tools</span>
        )}
        <span
          style={{
            ...styles.interactionRiskPill,
            ...(risk.level === 'high' ? styles.interactionRiskHigh : {}),
            ...(risk.level === 'medium' ? styles.interactionRiskMedium : {}),
            ...(risk.level === 'low' ? styles.interactionRiskLow : {}),
          }}
          title={risk.reasons.join(', ')}
        >
          {risk.label}
        </span>
        <span style={styles.interactionRunNarrative}>{narrative}</span>
        <span
          style={{
            ...styles.interactionAssistText,
            ...(inputNotice?.tone === 'warning' ? styles.interactionAssistWarning : {}),
          }}
        >
          {assistText}
        </span>
      </div>
    </div>
  );
}
