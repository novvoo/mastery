import { describe, expect, test } from 'bun:test';

import { Schedule, CronScheduler } from '../../src/scheduler/cron/CronScheduler.js';
import { MessageBus } from '../../src/scheduler/subagent/MessageBus.js';
import { Task, TaskPriority, TaskStatus } from '../../src/scheduler/task-queue/Task.js';
import { TaskQueue } from '../../src/scheduler/task-queue/TaskQueue.js';

class MemoryStore {
  constructor(items = []) {
    this.items = items;
  }

  async load() {
    return this.items;
  }

  async save(items) {
    this.items = items;
  }
}

describe('scheduler edge cases', () => {
  test('Task restores explicit zero timestamps and retry values', () => {
    const task = Task.fromJSON({
      id: 'task-zero',
      type: 'build',
      status: TaskStatus.FAILED,
      priority: TaskPriority.CRITICAL,
      payload: {},
      error: '',
      createdAt: 0,
      updatedAt: 0,
      startedAt: 0,
      completedAt: 0,
      retryCount: 0,
      maxRetries: 0,
      parentId: '',
      scheduleId: '',
      dependsOn: [],
      completedDependencies: [],
    });

    expect(task.createdAt).toBe(0);
    expect(task.updatedAt).toBe(0);
    expect(task.startedAt).toBe(0);
    expect(task.completedAt).toBe(0);
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(0);
    expect(task.error).toBe('');
    expect(task.parentId).toBe('');
    expect(task.scheduleId).toBe('');
  });

  test('TaskQueue list honors explicit zero limit', async () => {
    const queue = new TaskQueue(new MemoryStore());
    await queue.initialize();
    await queue.add({ id: 'a', type: 'one' });
    await queue.add({ id: 'b', type: 'two' });

    expect(queue.list({ limit: 0 })).toEqual([]);
  });

  test('Cron schedule restores explicit zero timing fields', () => {
    const schedule = Schedule.fromJSON({
      id: 'schedule-zero',
      name: 'zero schedule',
      cron: '* * * * *',
      taskType: 'noop',
      enabled: true,
      maxRuns: null,
      runCount: 0,
      lastRunAt: 0,
      nextRunAt: 0,
      createdAt: 0,
      updatedAt: 0,
    });

    expect(schedule.runCount).toBe(0);
    expect(schedule.lastRunAt).toBe(0);
    expect(schedule.nextRunAt).toBe(0);
    expect(schedule.createdAt).toBe(0);
    expect(schedule.updatedAt).toBe(0);
  });

  test('CronScheduler update can disable a schedule and list honors zero limit', async () => {
    const scheduler = new CronScheduler(new MemoryStore());
    await scheduler.initialize();
    const schedule = await scheduler.add({
      id: 'nightly',
      name: 'nightly',
      cron: '* * * * *',
      taskType: 'build',
    });

    const updated = await scheduler.update(schedule.id, { enabled: false });

    expect(updated.enabled).toBe(false);
    expect(updated.nextRunAt).toBeNull();
    expect(scheduler.list({ limit: 0 })).toEqual([]);
  });

  test('MessageBus supports disabling history and explicit zero limit', () => {
    const noHistoryBus = new MessageBus({ maxHistory: 0 });
    noHistoryBus.send({ from: 'a', to: 'b', event: 'ping', data: '' });

    expect(noHistoryBus.getStats().historyCount).toBe(0);
    expect(noHistoryBus.getHistory()).toEqual([]);

    const bus = new MessageBus();
    bus.send({ from: 'a', to: 'b', event: 'ping' });

    expect(bus.getHistory({ limit: 0 })).toEqual([]);
  });
});
