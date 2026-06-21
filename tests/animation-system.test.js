import { describe, expect, test } from 'bun:test';
import {
  MOTION_MODES,
  getAnimationMode,
  getMotionClassNames,
  getSendButtonMotionClass,
  getStageMotionClass,
} from '../desktop/renderer/app/interaction/animation-system.js';

describe('desktop animation system', () => {
  test('selects semantic motion modes from runtime state', () => {
    expect(getAnimationMode({ status: 'idle', messages: [] })).toBe(MOTION_MODES.IDLE);
    expect(getAnimationMode({ status: 'running', messages: [] })).toBe(MOTION_MODES.REQUESTING);
    expect(getAnimationMode({ status: 'running', messages: [{ type: 'thinking' }] })).toBe(MOTION_MODES.THINKING);
    expect(getAnimationMode({ status: 'running', messages: [{ type: 'tool', toolName: 'read_file' }] })).toBe(MOTION_MODES.TOOL_USE);
    expect(getAnimationMode({ status: 'running', messages: [{ type: 'assistant_stream' }] })).toBe(MOTION_MODES.RESPONDING);
    expect(getAnimationMode({ status: 'needs_user_input', messages: [] })).toBe(MOTION_MODES.WAITING);
    expect(getAnimationMode({ status: 'completed', messages: [] })).toBe(MOTION_MODES.COMPLETE);
    expect(getAnimationMode({ status: 'error', messages: [] })).toBe(MOTION_MODES.ERROR);
  });

  test('risk notices override normal idle animation', () => {
    expect(getAnimationMode({
      status: 'idle',
      messages: [],
      riskLevel: 'high',
    })).toBe(MOTION_MODES.WAITING);

    expect(getAnimationMode({
      status: 'idle',
      messages: [],
      notice: { tone: 'warning', text: 'confirm' },
    })).toBe(MOTION_MODES.WAITING);
  });

  test('class helpers produce stable CSS hooks', () => {
    expect(getMotionClassNames(MOTION_MODES.THINKING)).toBe('agent-motion agent-motion--thinking');
    expect(getMotionClassNames(MOTION_MODES.THINKING, { reducedMotion: true })).toContain('agent-motion--reduced');
    expect(getStageMotionClass('active')).toBe('agent-stage--active');
    expect(getStageMotionClass('attention')).toBe('agent-stage--attention');
    expect(getSendButtonMotionClass('running', 'hello')).toBe('agent-send--stop');
    expect(getSendButtonMotionClass('idle', 'hello')).toBe('agent-send--ready');
    expect(getSendButtonMotionClass('idle', '')).toBe('agent-send--idle');
  });
});

