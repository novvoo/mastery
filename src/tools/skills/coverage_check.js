import { ToolCategory } from '../../core/types.js';

/**
 * coverage_check - Answer readiness and retrieval planning gate.
 * Checks whether the current evidence is enough before answering and turns
 * missing facts into concrete retrieval actions.
 */
export default function coverageCheck() {
  return {
    name: 'coverage_check',
    description:
      'Answer readiness gate for RAG, web search, and uncertain answers. Checks whether available evidence is enough, names missing facts, and recommends concrete retrieval actions before producing a final answer.',
    category: ToolCategory.skill_engineering,
    params: {
      question: {
        type: 'string',
        description: 'The user question or claim that needs an answer.',
      },
      current_evidence: {
        type: 'string',
        description:
          'Evidence currently available from context, files, RAG chunks, web pages, command output, or prior tool results.',
      },
      required_facts: {
        type: 'string',
        description:
          'Optional comma-separated facts that must be known to answer safely. If omitted, the tool infers likely requirements from the question.',
      },
      available_sources: {
        type: 'string',
        description:
          'Optional comma-separated source types available now, such as context, code, rag, web, logs, tests, user.',
      },
      answer_goal: {
        type: 'string',
        description:
          'Optional answer goal, such as explain, recommend, compare, debug, summarize, or decide.',
      },
      risk_level: {
        type: 'string',
        description: 'Optional risk level for the answer.',
        enum: ['low', 'medium', 'high'],
      },
    },
    required: ['question'],
    handler: async (params) => {
      const question = normalizeText(params.question);
      const evidence = normalizeText(params.current_evidence);
      const answerGoal = normalizeText(params.answer_goal);
      const riskLevel = normalizeRisk(params.risk_level, question);
      const availableSources = splitList(params.available_sources).map((item) =>
        item.toLowerCase(),
      );
      const requiredFacts = splitList(params.required_facts);
      const inferredFacts =
        requiredFacts.length > 0
          ? requiredFacts
          : inferRequiredFacts(question, answerGoal, riskLevel);

      const evidenceItems = splitEvidence(evidence);
      const factAssessments = inferredFacts.map((fact) => assessFactCoverage(fact, evidenceItems));
      const missingFacts = factAssessments.filter((item) => item.status !== 'covered');
      const retrievals = suggestRetrievals(missingFacts, question, availableSources, riskLevel);
      const readiness = determineReadiness({ missingFacts, retrievals, riskLevel, evidenceItems });

      return formatCoverageReport({
        question,
        answerGoal,
        riskLevel,
        evidenceItems,
        factAssessments,
        missingFacts,
        retrievals,
        readiness,
      });
    },
  };
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRisk(value, question) {
  const explicit = normalizeText(value).toLowerCase();
  if (['low', 'medium', 'high'].includes(explicit)) {
    return explicit;
  }

  const text = question.toLowerCase();
  if (
    /安全|权限|漏洞|线上|生产|医疗|法律|金融|合规|隐私|security|prod|production|medical|legal|finance|compliance|privacy/.test(
      text,
    )
  ) {
    return 'high';
  }
  if (
    /最新|当前|今天|版本|价格|政策|法规|api|依赖|current|latest|today|version|price|policy|regulation/.test(
      text,
    )
  ) {
    return 'medium';
  }
  return 'low';
}

function splitList(value) {
  return normalizeText(value)
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitEvidence(value) {
  const text = normalizeText(value);
  if (!text) {
    return [];
  }
  return text
    .split(/\n{2,}|(?:^|\n)\s*[-*]\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferRequiredFacts(question, answerGoal, riskLevel) {
  const text = `${question} ${answerGoal}`.toLowerCase();
  const facts = [];

  facts.push('User intent and answer scope');

  if (/文档|资料|pdf|docx|rag|知识库|document|spec|requirement|manual/.test(text)) {
    facts.push('Relevant document passages from the project RAG index');
    facts.push('Document source identity and whether it is current enough');
  }

  if (
    /代码|实现|bug|错误|报错|栈|日志|文件|函数|模块|code|implementation|error|stack|log|file|function|module/.test(
      text,
    )
  ) {
    facts.push('Relevant code locations or logs');
    facts.push('Observed behavior or reproduction evidence');
  }

  if (
    /最新|当前|今天|现在|实时|价格|版本|政策|法规|新闻|weather|latest|current|today|now|real-time|price|version|policy|regulation|news/.test(
      text,
    )
  ) {
    facts.push('Fresh external source with date or timestamp');
    facts.push('Reliable source attribution');
  }

  if (
    /比较|选择|推荐|方案|架构|设计|compare|choose|recommend|option|architecture|design/.test(text)
  ) {
    facts.push('Decision criteria or constraints');
    facts.push('Tradeoffs for each viable option');
  }

  if (/安全|权限|漏洞|合规|隐私|security|permission|vulnerability|compliance|privacy/.test(text)) {
    facts.push('Security boundary and threat model');
    facts.push('Evidence for risky data flows or permissions');
  }

  if (/总结|解释|是什么|为什么|summary|explain|what is|why/.test(text)) {
    facts.push('Grounding evidence for the main claims');
  }

  if (riskLevel === 'high') {
    facts.push('Independent verification or explicit uncertainty for high-risk claims');
  }

  return unique(facts);
}

function assessFactCoverage(fact, evidenceItems) {
  if (evidenceItems.length === 0) {
    return {
      fact,
      status: 'missing',
      evidence: [],
      reason: 'No current evidence was provided.',
    };
  }

  const factKeywords = keywords(fact);
  const matches = evidenceItems.filter((item) => {
    const itemText = item.toLowerCase();
    return factKeywords.some((keyword) => itemText.includes(keyword));
  });

  if (matches.length > 0) {
    return {
      fact,
      status: 'covered',
      evidence: matches.slice(0, 3),
      reason: 'Evidence appears to cover this requirement.',
    };
  }

  const genericEvidence = evidenceItems.filter((item) => item.length > 24).slice(0, 2);
  return {
    fact,
    status: 'uncertain',
    evidence: genericEvidence,
    reason: 'Some evidence exists, but it does not clearly target this fact.',
  };
}

function keywords(text) {
  const normalized = text.toLowerCase();
  const words = normalized
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
    .filter(
      (word) =>
        ![
          'the',
          'and',
          'for',
          'with',
          'from',
          'that',
          'this',
          'must',
          'known',
          'evidence',
          'source',
          'relevant',
          'current',
          'enough',
          'fact',
          'facts',
        ].includes(word),
    );

  const phraseAliases = {
    document: ['document', 'rag', 'pdf', 'docx', 'spec', 'manual', '文档', '资料'],
    code: ['code', 'implementation', 'file', 'function', 'module', '代码', '实现', '文件'],
    fresh: ['fresh', 'latest', 'current', 'today', 'timestamp', '最新', '当前', '今天'],
    security: ['security', 'permission', 'privacy', '安全', '权限', '隐私'],
    criteria: ['criteria', 'constraint', 'tradeoff', '标准', '约束', '取舍'],
  };

  for (const [trigger, aliases] of Object.entries(phraseAliases)) {
    if (normalized.includes(trigger) || aliases.some((alias) => normalized.includes(alias))) {
      words.push(...aliases);
    }
  }

  return unique(words);
}

function suggestRetrievals(missingFacts, question, availableSources, riskLevel) {
  const retrievals = [];
  const missingText = missingFacts
    .map((item) => item.fact)
    .join(' ')
    .toLowerCase();
  const hasSource = (source) => availableSources.includes(source);

  if (/document|rag|pdf|docx|spec|manual|文档|资料|知识库/.test(missingText)) {
    retrievals.push({
      tool: hasSource('rag') || availableSources.length === 0 ? 'document_search' : 'document_add',
      query: makeQuery(question, 'relevant requirements risks constraints'),
      reason: 'Missing facts depend on user-provided or indexed documents.',
    });
  }

  if (/code|implementation|file|function|module|log|代码|实现|文件|日志/.test(missingText)) {
    retrievals.push({
      tool: 'semantic_search',
      query: makeQuery(question, 'implementation behavior related files logs'),
      reason: 'Missing facts depend on code, logs, or project behavior.',
    });
  }

  if (
    /fresh|external|timestamp|latest|current|today|policy|regulation|price|news|最新|当前|今天|政策|法规|价格/.test(
      missingText,
    )
  ) {
    retrievals.push({
      tool: 'web_search',
      query: makeQuery(question, 'official source latest current'),
      reason: 'Missing facts are time-sensitive or external to the project.',
    });
  }

  if (/criteria|constraint|scope|intent|验收|约束|范围|意图/.test(missingText)) {
    retrievals.push({
      tool: 'ask_user',
      query: 'Clarify missing decision criteria, constraints, or scope.',
      reason: 'The missing fact is a user/business constraint rather than searchable public data.',
    });
  }

  if (riskLevel === 'high' && !retrievals.some((item) => item.tool === 'verify')) {
    retrievals.push({
      tool: 'verify',
      query: 'Verify high-risk claims against fresh evidence before final answer.',
      reason: 'High-risk answers need explicit evidence or uncertainty.',
    });
  }

  if (retrievals.length === 0 && missingFacts.length > 0) {
    retrievals.push({
      tool: 'semantic_search',
      query: makeQuery(question, missingFacts[0].fact),
      reason: 'Default to project semantic search for unresolved evidence gaps.',
    });
  }

  return dedupeRetrievals(retrievals);
}

function makeQuery(question, suffix) {
  const base = normalizeText(question).replace(/\s+/g, ' ').slice(0, 140);
  return `${base} ${suffix}`.trim();
}

function determineReadiness({ missingFacts, retrievals, riskLevel, evidenceItems }) {
  if (missingFacts.length === 0 && evidenceItems.length > 0) {
    return {
      status: 'READY',
      summary: 'Current evidence appears sufficient for a grounded answer.',
    };
  }

  const onlyUserGaps =
    retrievals.length > 0 && retrievals.every((item) => item.tool === 'ask_user');
  if (onlyUserGaps) {
    return {
      status: 'ASK_USER',
      summary: 'The answer depends on missing user or business constraints.',
    };
  }

  if (riskLevel === 'high' || missingFacts.length > 0) {
    return {
      status: 'NEEDS_RETRIEVAL',
      summary: 'Do not answer yet; retrieve or verify the missing facts first.',
    };
  }

  return {
    status: 'READY_WITH_CAVEATS',
    summary: 'Answer is possible, but note evidence limitations.',
  };
}

function formatCoverageReport({
  question,
  answerGoal,
  riskLevel,
  evidenceItems,
  factAssessments,
  missingFacts,
  retrievals,
  readiness,
}) {
  const lines = [
    '# Coverage Check',
    '',
    `**Readiness:** ${readiness.status}`,
    `**Summary:** ${readiness.summary}`,
    `**Risk level:** ${riskLevel}`,
    `**Question:** ${question}`,
  ];

  if (answerGoal) {
    lines.push(`**Answer goal:** ${answerGoal}`);
  }

  lines.push('', '## Required Facts');
  for (const item of factAssessments) {
    lines.push(`- **${item.status.toUpperCase()}** ${item.fact}`);
    if (item.reason) {
      lines.push(`  - ${item.reason}`);
    }
    for (const evidence of item.evidence || []) {
      lines.push(`  - Evidence: ${truncate(evidence, 180)}`);
    }
  }

  lines.push('', '## Evidence Inventory');
  if (evidenceItems.length === 0) {
    lines.push('- No current evidence provided.');
  } else {
    for (const item of evidenceItems.slice(0, 8)) {
      lines.push(`- ${truncate(item, 180)}`);
    }
  }

  lines.push('', '## Missing Facts');
  if (missingFacts.length === 0) {
    lines.push('- None detected.');
  } else {
    for (const item of missingFacts) {
      lines.push(`- ${item.fact}`);
    }
  }

  lines.push('', '## Suggested Retrievals');
  if (retrievals.length === 0) {
    lines.push('- None. Proceed to answer with citations/evidence where appropriate.');
  } else {
    for (const item of retrievals) {
      lines.push(`- **${item.tool}**: ${item.query}`);
      lines.push(`  - Reason: ${item.reason}`);
    }
  }

  lines.push('', '## Next Step');
  if (readiness.status === 'READY') {
    lines.push('Proceed to answer, citing or naming the evidence used.');
  } else if (readiness.status === 'ASK_USER') {
    lines.push('Ask the user for the missing constraint before answering.');
  } else {
    lines.push(
      'Run the suggested retrievals, then call coverage_check again or answer with remaining uncertainty clearly stated.',
    );
  }

  return lines.join('\n');
}

function truncate(value, maxLength) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function dedupeRetrievals(retrievals) {
  const seen = new Set();
  return retrievals.filter((item) => {
    const key = `${item.tool}:${item.query}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
