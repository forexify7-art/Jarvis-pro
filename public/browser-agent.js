import { readApiResponse } from './api-response.js';

export async function researchBrowserPage({
  url,
  question,
  headers = {},
  signal,
  fetchImpl = fetch,
}) {
  const pageUrl = typeof url === 'string' ? url.trim() : '';
  const researchQuestion = typeof question === 'string' ? question.trim() : '';
  if (!pageUrl || pageUrl.length > 2_048) {
    throw new TypeError('Enter a page URL of 1 to 2,048 characters.');
  }
  if (!researchQuestion || researchQuestion.length > 2_000) {
    throw new TypeError('Enter a research question of 1 to 2,000 characters.');
  }

  const response = await fetchImpl('/api/browser/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ url: pageUrl, question: researchQuestion }),
    signal,
  });
  const data = await readApiResponse(response);
  if (typeof data.result !== 'string' || !data.result.trim()) {
    throw new Error('Browser research returned no readable result.');
  }
  return { url: data.url, result: data.result.trim() };
}
