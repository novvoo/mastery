export const ADVISOR_SEVERITY_RANK = { nit: 1, concern: 2, blocker: 3 };

function advisorSeverityRank(severity) {
  return ADVISOR_SEVERITY_RANK[severity ?? 'nit'];
}

function advisorNoteDedupeKey(note) {
  return note.trim().replace(/\s+/g, ' ');
}

export function isInterruptingSeverity(severity) {
  return severity === 'concern' || severity === 'blocker';
}

export function resolveAdvisorDeliveryChannel(opts) {
  if (!isInterruptingSeverity(opts.severity)) return 'aside';
  if (opts.autoResumeSuppressed && (opts.aborting || !opts.streaming)) return 'preserve';
  if (opts.interruptImmuneTurnActive) return 'aside';
  return 'steer';
}

export class AdviseTool {
  constructor(onAdvice) {
    this.name = 'advise';
    this.label = 'Advise';
    this.description = `# Advise Tool

You are a watcher agent reviewing the primary agent's work. Use this tool to provide specific, actionable advice.

**Parameters:**
- \`note\`: One concrete piece of advice for the agent you are watching. Terse, specific, actionable.
- \`severity\` (optional): 'nit' | 'concern' | 'blocker'. How strongly to weigh this advice.

**Guidelines:**
- At most one advice per update
- NEVER repeat advice you already gave
- Be specific, not generic
- Focus on code quality, correctness, and best practices`;

    this.parameters = {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'One concrete piece of advice for the agent you are watching. Terse, specific, actionable.',
        },
        severity: {
          type: 'string',
          enum: ['nit', 'concern', 'blocker'],
          description: 'How strongly to weigh this. Omit for a plain nit.',
        },
      },
      required: ['note'],
    };

    this.onAdvice = onAdvice;
    this.#deliveredNoteSeverities = new Map();
  }

  #deliveredNoteSeverities;

  resetDeliveredNotes() {
    this.#deliveredNoteSeverities.clear();
  }

  async execute(args) {
    const key = advisorNoteDedupeKey(args.note);
    const rank = advisorSeverityRank(args.severity);
    const previousRank = this.#deliveredNoteSeverities.get(key) ?? 0;

    if (rank <= previousRank) {
      return {
        content: [{ type: 'text', text: 'Duplicate advice ignored.' }],
        details: { note: args.note, severity: args.severity },
        useless: true,
      };
    }

    this.#deliveredNoteSeverities.set(key, rank);
    this.onAdvice(args.note, args.severity);

    return {
      content: [{ type: 'text', text: 'Recorded.' }],
      details: { note: args.note, severity: args.severity },
      useless: true,
    };
  }
}
