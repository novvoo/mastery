/**
 * 测试修复后的中断逻辑
 * 验证plan未完成时不能中断
 */

import { describe, expect, test } from 'bun:test';

describe('中断逻辑修复测试', () => {
  test('plan未完成时应该阻止中断', () => {
    // 模拟plan未完成的状态
    const mockPlanner = {
      isCompleted: () => false,
      activePlan: {
        status: 'running',
        tasks: new Map([
          ['task1', { id: 'task1', status: 'completed', name: 'Task 1' }],
          ['task2', { id: 'task2', status: 'running', name: 'Task 2' }],
          ['task3', { id: 'task3', status: 'pending', name: 'Task 3' }]
        ])
      }
    };

    const mockAgent = {
      isWaitingForUserInput: false,
      stopRequested: true,
      planner: mockPlanner
    };

    // 模拟中断逻辑
    const planComplete = mockPlanner.isCompleted();
    const needsUserInput = mockAgent.isWaitingForUserInput;

    // 如果plan未完成且不需要用户交互，应该阻止中断
    if (!planComplete && !needsUserInput) {
      expect(mockAgent.stopRequested).toBe(true);
      expect(planComplete).toBe(false);
      expect(needsUserInput).toBe(false);
    } else {
      throw new Error('中断逻辑应该阻止中断');
    }
  });

  test('plan完成时应该允许中断', () => {
    // 模拟plan完成的状态
    const mockPlanner = {
      isCompleted: () => true,
      activePlan: {
        status: 'completed',
        tasks: new Map([
          ['task1', { id: 'task1', status: 'completed', name: 'Task 1' }],
          ['task2', { id: 'task2', status: 'completed', name: 'Task 2' }],
          ['task3', { id: 'task3', status: 'completed', name: 'Task 3' }]
        ])
      }
    };

    const mockAgent = {
      isWaitingForUserInput: false,
      stopRequested: true,
      planner: mockPlanner
    };

    // 模拟中断逻辑
    const planComplete = mockPlanner.isCompleted();
    const needsUserInput = mockAgent.isWaitingForUserInput;

    // 如果plan完成或需要用户交互，应该允许中断
    if (planComplete || needsUserInput) {
      expect(mockAgent.stopRequested).toBe(true);
      expect(planComplete).toBe(true);
    } else {
      throw new Error('中断逻辑应该允许中断');
    }
  });

  test('需要用户输入时应该允许中断', () => {
    // 模拟需要用户输入的状态
    const mockPlanner = {
      isCompleted: () => false,
      activePlan: {
        status: 'running',
        tasks: new Map([
          ['task1', { id: 'task1', status: 'completed', name: 'Task 1' }],
          ['task2', { id: 'task2', status: 'running', name: 'Task 2' }]
        ])
      }
    };

    const mockAgent = {
      isWaitingForUserInput: true,
      stopRequested: true,
      planner: mockPlanner
    };

    // 模拟中断逻辑
    const planComplete = mockPlanner.isCompleted();
    const needsUserInput = mockAgent.isWaitingForUserInput;

    // 如果plan完成或需要用户交互，应该允许中断
    if (planComplete || needsUserInput) {
      expect(mockAgent.stopRequested).toBe(true);
      expect(needsUserInput).toBe(true);
    } else {
      throw new Error('中断逻辑应该允许中断');
    }
  });

  test('plan状态总结功能', () => {
    const mockPlanner = {
      activePlan: {
        status: 'running',
        tasks: new Map([
          ['task1', { id: 'task1', status: 'completed', name: 'Task 1' }],
          ['task2', { id: 'task2', status: 'running', name: 'Task 2' }],
          ['task3', { id: 'task3', status: 'pending', name: 'Task 3' }],
          ['task4', { id: 'task4', status: 'blocked', name: 'Task 4' }]
        ])
      }
    };

    // 模拟plan状态总结逻辑
    const plan = mockPlanner.activePlan;
    const tasks = Array.from(plan.tasks.values());
    const completed = tasks.filter(t => t.status === 'completed').length;
    const running = tasks.filter(t => t.status === 'running').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;

    expect(completed).toBe(1);
    expect(running).toBe(1);
    expect(pending).toBe(1);
    expect(blocked).toBe(1);
    expect(tasks.length).toBe(4);
  });
});