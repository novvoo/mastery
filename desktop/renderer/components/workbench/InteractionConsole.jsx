import React from 'react';
import {
  assessPromptRisk,
  createRunNarrative,
  deriveInteractionStages,
  getComposerAssistText,
  getShortcutHints,
  getToolActivitySummary,
} from '../../app/interaction-model.js';
import {
  getAnimationMode,
  getMotionClassNames,
  getStageMotionClass,
} from '../../app/animation-system.js';
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
  const shortcuts = getShortcutHints({ hasHistory: true, status });
  const narrative = createRunNarrative({ status, messages });
  const assistText = getComposerAssistText({ status, value: inputValue, notice: inputNotice });
  const motionMode = getAnimationMode({
    status,
    messages,
    riskLevel: risk.level,
    notice: inputNotice,
  });

  return (
    <div
      className={getMotionClassNames(motionMode)}
      style={styles.interactionConsole}
      aria-label="interaction-console"
    >
      <div style={styles.interactionStages}>
        {stages.map(stage => (
          <div
            key={stage.key}
            className={getStageMotionClass(stage.state)}
            style={{
              ...styles.interactionStage,
              ...getStageStyle(stage.state),
            }}
            title={`${stage.label}: ${stage.detail}`}
          >
            <span className="interactionStageDot" style={styles.interactionStageDot} />
            <span style={styles.interactionStageLabel}>{stage.label}</span>
            <span style={styles.interactionStageDetail}>{stage.detail}</span>
          </div>
        ))}
      </div>
      <div style={styles.interactionMetaRow}>
        <span className="agent-motion-glyph" aria-hidden="true" />
        <span style={styles.interactionMetaPill}>Tools {tools?.length || 0}</span>
        <span style={styles.interactionMetaPill}>Latest {toolSummary.latestTool}</span>
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
      </div>
      <div style={styles.interactionMetaRow}>
        {shortcuts.map(shortcut => (
          <span key={shortcut.key} style={styles.interactionShortcut}>
            <kbd style={styles.interactionShortcutKey}>{shortcut.key}</kbd>
            <span>{shortcut.label}</span>
          </span>
        ))}
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
