export const PolicyEffect = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
});

const RISK_WEIGHT = Object.freeze({
  standard: 1,
  high: 2,
  critical: 3,
});

export class PolicyDeniedError extends Error {
  constructor(channel, reason, decisionId) {
    super(reason || `policy denied command: ${channel}`);
    this.name = 'PolicyDeniedError';
    this.code = 'POLICY_DENIED';
    this.details = { channel, decisionId };
  }
}

export class CapabilityPolicyEngine {
  #profile;
  #rules;
  #decisions = [];
  #maxDecisions;
  #sequence = 0;

  constructor({ profile = 'local-full', rules = [], maxDecisions = 200 } = {}) {
    this.#profile = profile;
    this.#rules = [...rules];
    this.#maxDecisions = maxDecisions;
  }

  authorize({ channel, risk = 'standard', capability = null, context = {} }) {
    const matchingRule = this.#rules.find((rule) => rule.matches?.({
      channel,
      risk,
      capability,
      context,
    }));
    const profileAllows = this.#profile === 'local-full'
      || (this.#profile === 'standard' && RISK_WEIGHT[risk] < RISK_WEIGHT.critical);
    const effect = matchingRule?.effect || (profileAllows ? PolicyEffect.ALLOW : PolicyEffect.DENY);
    const decision = {
      id: `policy_${Date.now()}_${++this.#sequence}`,
      timestamp: Date.now(),
      profile: this.#profile,
      channel,
      capability,
      risk,
      effect,
      reason: matchingRule?.reason || (profileAllows ? 'profile_allows' : 'risk_exceeds_profile'),
      actor: context.actor || 'renderer',
    };
    this.#decisions.push(decision);
    if (this.#decisions.length > this.#maxDecisions) this.#decisions.shift();
    if (effect === PolicyEffect.DENY) {
      throw new PolicyDeniedError(channel, decision.reason, decision.id);
    }
    return { ...decision };
  }

  getSnapshot() {
    return {
      profile: this.#profile,
      decisions: this.#decisions.map((decision) => ({ ...decision })),
    };
  }
}

export function createDesktopPolicyEngine(options = {}) {
  return new CapabilityPolicyEngine(options);
}
