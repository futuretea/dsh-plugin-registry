export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

const rank = (risk) => RISK_LEVELS.indexOf(risk);

export function dependencyRisk(audit) {
  if (!audit) return 'unknown';
  if (audit.critical > 0) return 'critical';
  if (audit.high > 0) return 'high';
  if (audit.moderate > 0) return 'medium';
  return 'low';
}

export function classifyRisk({ audit, secrets }) {
  const dep = dependencyRisk(audit);
  if (secrets.length > 0) return rank(dep) > rank('high') ? dep : 'high';
  return dep;
}

export function isRiskAllowed(risk, maxRisk) {
  return risk !== 'unknown' && rank(risk) <= rank(maxRisk);
}
