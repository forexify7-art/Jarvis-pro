import assert from 'node:assert/strict';
import test from 'node:test';
import { researchBrowserPage } from '../public/browser-agent.js';

test('sends a bounded page URL and question with server authorization', async () => {
  let request;
  const result = await researchBrowserPage({
    url: ' https://example.com/article ',
    question: ' Summarize the article ',
    headers: { authorization: 'Bearer test-token' },
    signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ url: 'https://example.com/article', result: 'Article summary.' });
    },
  });

  assert.equal(request.url, '/api/browser/research');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    url: 'https://example.com/article',
    question: 'Summarize the article',
  });
  assert.deepEqual(result, { url: 'https://example.com/article', result: 'Article summary.' });
});

test('rejects empty or oversized research inputs before making a request', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return Response.json({ result: 'unused' });
  };

  await assert.rejects(
    researchBrowserPage({ url: ' ', question: 'question', fetchImpl }),
    /page URL/,
  );
  await assert.rejects(
    researchBrowserPage({ url: 'https://example.com', question: 'q'.repeat(2_001), fetchImpl }),
    /research question/,
  );
  assert.equal(requestCount, 0);
});

test('surfaces server errors and rejects success responses without a readable result', async () => {
  await assert.rejects(
    researchBrowserPage({
      url: 'https://example.com',
      question: 'question',
      fetchImpl: async () => Response.json({ error: 'Browser Use is unavailable.' }, { status: 503 }),
    }),
    /Browser Use is unavailable/,
  );
  await assert.rejects(
    researchBrowserPage({
      url: 'https://example.com',
      question: 'question',
      fetchImpl: async () => Response.json({ result: '' }),
    }),
    /no readable result/,
  );
});
