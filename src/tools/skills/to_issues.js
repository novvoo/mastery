import { ToolCategory } from '../../core/types/index.js';

/**
 * Estimate complexity based on the granularity level.
 */
function estimateComplexity(granularity) {
  switch (granularity) {
    case 'epic':
      return 'Large (2-4 weeks)';
    case 'story':
      return 'Medium (3-5 days)';
    case 'task':
      return 'Small (0.5-1 day)';
    default:
      return 'Medium';
  }
}

/**
 * Generate a unique issue ID based on index and granularity.
 */
function issueId(index, granularity) {
  const prefix = granularity === 'epic' ? 'EPIC' : granularity === 'story' ? 'STORY' : 'TASK';
  return `${prefix}-${String(index).padStart(3, '0')}`;
}

/**
 * Split a plan into vertical-slice issues.
 */
function splitPlanIntoIssues(plan, granularity, assignee) {
  // Split the plan into logical segments by double newlines or numbered/bulleted items
  const segments = plan
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Further split segments that contain numbered items or bullet points
  const items = [];
  for (const segment of segments) {
    const lines = segment
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // Check if this segment has multiple numbered/bulleted items
    const subItems = lines.filter((l) => /^(\d+[\.\)]\s|[-*]\s)/.test(l));
    if (subItems.length > 1) {
      for (const sub of subItems) {
        const cleaned = sub.replace(/^(\d+[\.\)]\s|[-*]\s)/, '').trim();
        if (cleaned) {
          items.push(cleaned);
        }
      }
    } else {
      items.push(segment);
    }
  }

  // If still no meaningful split, split by sentences
  if (items.length <= 1) {
    const sentences = plan
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    items.push(...sentences);
  }

  const complexity = estimateComplexity(granularity);
  const issues = items.map((item, index) => {
    const id = issueId(index + 1, granularity);
    // Derive a verb-first title from the item
    const title = toVerbFirst(item);
    return {
      id,
      title,
      description: item,
      acceptanceCriteria: generateAcceptanceCriteria(item),
      dependencies: index > 0 ? [issueId(index, granularity)] : [],
      complexity,
      assignee: assignee || 'Unassigned',
      verticalSlice: `VS-${index + 1}`,
    };
  });

  return issues;
}

/**
 * Convert a description to a verb-first title.
 */
function toVerbFirst(text) {
  // Take the first meaningful phrase and ensure it starts with a verb
  let title = text.split(/[.!?]/)[0].trim();
  // Remove leading articles
  title = title.replace(/^(the|a|an)\s+/i, '');
  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);
  // If too long, truncate
  if (title.length > 80) {
    title = title.substring(0, 77) + '...';
  }
  return title;
}

/**
 * Generate Given-When-Then acceptance criteria from a description.
 */
function generateAcceptanceCriteria(description) {
  const shortDesc = description.length > 60 ? description.substring(0, 60) + '...' : description;
  return [
    `**Given** the system is in the initial state`,
    `**When** "${shortDesc}" is executed`,
    `**Then** the expected outcome is achieved and verified`,
  ];
}

/**
 * Build a dependency graph in ASCII form.
 */
function buildDependencyGraph(issues) {
  if (issues.length === 0) {
    return '_No issues._';
  }
  if (issues.length === 1) {
    return `${issues[0].id} --> [Complete]`;
  }

  const lines = [];
  for (const issue of issues) {
    if (issue.dependencies.length > 0) {
      lines.push(`${issue.dependencies.join(', ')} --> ${issue.id}`);
    } else {
      lines.push(`${issue.id} --> [Start]`);
    }
  }
  return lines.join('\n');
}

/**
 * Determine recommended execution order.
 */
function executionOrder(issues) {
  return issues.map((issue, i) => `${i + 1}. ${issue.id}: ${issue.title}`).join('\n');
}

export default function to_issues() {
  return {
    name: 'to_issues',
    description:
      'Split a plan into vertical-slice issues. Generates a structured issue list with titles (verb-first), descriptions, Given-When-Then acceptance criteria, dependencies, complexity estimates, and a dependency graph with recommended execution order.',
    category: ToolCategory.skill_output,
    params: {
      plan: {
        type: 'string',
        description: 'The plan text to split into issues.',
      },
      granularity: {
        type: 'string',
        description: 'The granularity level for issue generation.',
        enum: ['epic', 'story', 'task'],
      },
      assignee: {
        type: 'string',
        description: 'Default assignee for all generated issues.',
      },
    },
    required: ['plan', 'granularity'],
    handler: async (params) => {
      const { plan, granularity, assignee } = params;

      const issues = splitPlanIntoIssues(plan, granularity, assignee);
      const graph = buildDependencyGraph(issues);
      const order = executionOrder(issues);

      // Build markdown output
      const sections = [
        `# Issue List`,
        ``,
        `**Granularity:** ${granularity}`,
        `**Total Issues:** ${issues.length}`,
        `**Assignee:** ${assignee || 'Unassigned'}`,
        ``,
        `---`,
        ``,
      ];

      // Individual issues
      for (const issue of issues) {
        sections.push(
          `## ${issue.id}: ${issue.title}`,
          ``,
          `- **Vertical Slice:** ${issue.verticalSlice}`,
          `- **Complexity:** ${issue.complexity}`,
          `- **Assignee:** ${issue.assignee}`,
          `- **Dependencies:** ${issue.dependencies.length > 0 ? issue.dependencies.join(', ') : 'None'}`,
          ``,
          `### Description`,
          ``,
          `${issue.description}`,
          ``,
          `### Acceptance Criteria`,
          ``,
          ...issue.acceptanceCriteria.map((ac) => `- ${ac}`),
          ``,
          `---`,
          ``,
        );
      }

      // Dependency graph
      sections.push(`## Dependency Graph`, ``, '```', graph, '```', ``);

      // Recommended execution order
      sections.push(
        `## Recommended Execution Order`,
        ``,
        order,
        ``,
        `---`,
        ``,
        `*Generated by AI Engineering Mastery Agent - Issue Splitter Tool*`,
      );

      return sections.join('\n');
    },
  };
}
