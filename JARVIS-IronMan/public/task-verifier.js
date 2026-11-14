// Verifies a step's real result against an explicit expectation. Never reports success by default.
export function verifyStepResult(step, result) {
  if (!step || typeof step !== 'object') return { passed: false, reason: 'Missing step.' };
  const expect = step.expect ?? { type: 'defined' };
  switch (expect.type) {
    case 'defined':
      return result === undefined || result === null
        ? { passed: false, reason: 'The step returned no result.' } : { passed: true };
    case 'non-empty-text':
      return typeof result === 'string' && result.trim()
        ? { passed: true } : { passed: false, reason: 'Expected non-empty text.' };
    case 'includes':
      return typeof result === 'string' && result.includes(expect.value)
        ? { passed: true } : { passed: false, reason: `Result does not include "${expect.value}".` };
    case 'min-length':
      return (result?.length ?? 0) >= expect.value
        ? { passed: true } : { passed: false, reason: `Expected length of at least ${expect.value}.` };
    case 'file-created':
      return result && typeof result.name === 'string' && result.size > 0
        ? { passed: true } : { passed: false, reason: 'No non-empty file was produced.' };
    case 'predicate':
      try {
        return expect.check(result) ? { passed: true } : { passed: false, reason: expect.reason || 'Custom check failed.' };
      } catch (error) {
        return { passed: false, reason: `Check threw: ${error.message}` };
      }
    default:
      return { passed: false, reason: `Unknown expectation type: ${expect.type}` };
  }
}
