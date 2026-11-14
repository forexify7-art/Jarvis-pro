// Runs a plan step by step: permission -> execute (with recovery) -> verify. Stops at the first failure.
import { withRecovery } from './error-recovery.js';
import { verifyStepResult } from './task-verifier.js';

export async function runPlan(plan, { handlers, broker, onProgress = () => {}, signal, recovery = {} }) {
  if (!plan?.steps?.length) throw new TypeError('A plan with at least one step is required.');
  if (!broker || typeof broker.request !== 'function') throw new TypeError('A permission broker is required.');
  const report = { goal: plan.goal, status: 'completed', steps: [] };

  for (const step of plan.steps) {
    const entry = { id: step.id, action: step.action, label: step.label, status: 'pending' };
    report.steps.push(entry);

    if (signal?.aborted) {
      entry.status = 'cancelled';
      report.status = 'cancelled';
      break;
    }
    const handler = handlers?.[step.action];
    if (typeof handler !== 'function') {
      entry.status = 'unsupported';
      entry.reason = `No handler is available for "${step.action}" on this device.`;
      report.status = 'failed';
      onProgress({ ...entry });
      break;
    }

    const permission = await broker.request(step.action, step.label);
    if (signal?.aborted) {
      entry.status = 'cancelled';
      entry.reason = 'Cancelled by user.';
      report.status = 'cancelled';
      onProgress({ ...entry });
      break;
    }
    if (!permission.allowed) {
      entry.status = 'denied';
      entry.reason = 'You did not approve this step.';
      report.status = 'stopped';
      onProgress({ ...entry });
      break;
    }

    onProgress({ ...entry, status: 'running' });
    const outcome = await withRecovery(() => handler(step.params, { signal }), recovery);
    if (!outcome.ok) {
      if (signal?.aborted || outcome.kind === 'cancelled') {
        entry.status = 'cancelled';
        entry.reason = 'Cancelled by user.';
        report.status = 'cancelled';
        onProgress({ ...entry });
        break;
      }
      entry.status = 'failed';
      entry.reason = outcome.error?.message || 'The step failed.';
      entry.attempts = outcome.attempts;
      report.status = 'failed';
      onProgress({ ...entry });
      break;
    }
    const verdict = verifyStepResult(step, outcome.value);
    entry.attempts = outcome.attempts;
    if (!verdict.passed) {
      entry.status = 'unverified';
      entry.reason = verdict.reason;
      report.status = 'failed';
      onProgress({ ...entry });
      break;
    }
    entry.status = 'done';
    entry.result = outcome.value;
    onProgress({ ...entry });
  }
  return report;
}
