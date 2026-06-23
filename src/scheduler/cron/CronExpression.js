/**
 * CronExpression.js
 * Cron表达式解析和计算实现
 */

/**
 * Cron表达式类
 * 解析cron表达式并计算下一次执行时间
 */
export class CronExpression {
  // 字段定义：名称、最小值、最大值
  static FIELD_DEFINITIONS = {
    minute: { min: 0, max: 59 },
    hour: { min: 0, max: 23 },
    day: { min: 1, max: 31 },
    month: { min: 1, max: 12 },
    dayOfWeek: { min: 0, max: 6 },
  };

  // 预定义表达式
  static PREDEFINED = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
  };

  /**
   * 创建Cron表达式实例
   * @param {string} expression - Cron表达式（5个字段）
   */
  constructor(expression) {
    // 处理预定义表达式
    if (expression.startsWith('@')) {
      if (!CronExpression.PREDEFINED[expression]) {
        throw new Error(`Unknown predefined expression: ${expression}`);
      }
      expression = CronExpression.PREDEFINED[expression];
    }

    this.expression = expression;
    this.fields = this.#parse();
  }

  /**
   * 解析表达式
   * @private
   * @returns {Object} 解析后的字段值
   */
  #parse() {
    const parts = this.expression.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: '${this.expression}'. Expected 5 fields, got ${parts.length}.`,
      );
    }

    const fieldNames = ['minute', 'hour', 'day', 'month', 'dayOfWeek'];
    const parsed = {};

    for (let i = 0; i < 5; i++) {
      const fieldName = fieldNames[i];
      const fieldDef = CronExpression.FIELD_DEFINITIONS[fieldName];
      parsed[fieldName] = this.#parseField(parts[i], fieldDef.min, fieldDef.max);
    }

    return parsed;
  }

  /**
   * 解析单个字段
   * @private
   * @param {string} field - 字段字符串
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @returns {Array<number>} 有效值数组
   */
  #parseField(field, min, max) {
    const values = new Set();

    // 处理逗号分隔的列表（如：1,2,3 或 MON,WED,FRI）
    const parts = field.split(',');

    for (const part of parts) {
      this.#parseFieldPart(part.trim(), min, max, values);
    }

    // 转换为排序后的数组
    return Array.from(values).sort((a, b) => a - b);
  }

  /**
   * 解析字段的单个部分
   * @private
   * @param {string} part - 字段部分
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @param {Set<number>} values - 值集合
   */
  #parseFieldPart(part, min, max, values) {
    // 处理通配符 *
    if (part === '*') {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
      return;
    }

    // 处理步长（如：*/5 或 1-10/2）
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);

      if (isNaN(step) || step < 1) {
        throw new Error(`Invalid step value: ${stepStr}`);
      }

      let start, end;

      if (range === '*') {
        start = min;
        end = max;
      } else if (range.includes('-')) {
        [start, end] = range.split('-').map((v) => parseInt(v, 10));
      } else {
        start = parseInt(range, 10);
        end = max;
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) {
          values.add(i);
        }
      }
      return;
    }

    // 处理范围（如：1-5）
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${part}`);
      }

      for (let i = start; i <= end; i++) {
        if (i >= min && i <= max) {
          values.add(i);
        }
      }
      return;
    }

    // 处理单个值
    const value = parseInt(part, 10);
    if (isNaN(value)) {
      throw new Error(`Invalid value: ${part}`);
    }

    if (value >= min && value <= max) {
      values.add(value);
    }
  }

  /**
   * 获取下一个匹配日期
   * @param {Date} [fromDate] - 起始日期（默认为当前时间）
   * @returns {Date|null} 下一个匹配的日期，如果没有则返回null
   */
  getNextDate(fromDate = new Date()) {
    // 从起始时间的下一分钟开始查找
    const date = new Date(fromDate);
    date.setSeconds(0, 0);
    date.setMinutes(date.getMinutes() + 1);

    // 最多查找4年（防止无限循环）
    const maxDate = new Date(fromDate);
    maxDate.setFullYear(maxDate.getFullYear() + 4);

    while (date <= maxDate) {
      if (this.#matches(date)) {
        return new Date(date);
      }
      date.setMinutes(date.getMinutes() + 1);
    }

    return null;
  }

  /**
   * 检查日期是否匹配表达式
   * @private
   * @param {Date} date - 日期对象
   * @returns {boolean}
   */
  #matches(date) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1; // JavaScript月份是0-11
    const dayOfWeek = date.getDay();

    return (
      this.fields.minute.includes(minute) &&
      this.fields.hour.includes(hour) &&
      this.fields.day.includes(day) &&
      this.fields.month.includes(month) &&
      this.fields.dayOfWeek.includes(dayOfWeek)
    );
  }

  /**
   * 获取接下来的多个匹配日期
   * @param {number} count - 获取数量
   * @param {Date} [fromDate] - 起始日期
   * @returns {Array<Date>} 日期数组
   */
  getNextDates(count, fromDate = new Date()) {
    const dates = [];
    let currentDate = fromDate;

    for (let i = 0; i < count; i++) {
      const nextDate = this.getNextDate(currentDate);
      if (!nextDate) {
        break;
      }
      dates.push(nextDate);
      currentDate = nextDate;
    }

    return dates;
  }

  /**
   * 获取表达式字符串表示
   * @returns {string}
   */
  toString() {
    return this.expression;
  }
}

export default CronExpression;
