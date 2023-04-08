import { parse } from 'node-html-parser';

const CACHE_NAME = 'preview-cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const template = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Twitter Cloak by Abe Voelker</title>
  <meta property="og:title" content="Twitter Cloak" />
  <meta property="og:description" content="Generate proxy links to content blocked on Twitter while preserving Twitter Card previews of the original content." />
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 py-10">
  <div class="container mx-auto max-w-md">
    <h1 class="text-2xl font-bold mb-4">Twitter Cloak&nbsp;<a href="https://twitter.com/abevoelker"><span class="text-gray-500 text-sm">by </span><span class="text-gray-500 underline text-sm">Abe Voelker</span></a></h1>
    <p class="mb-4 text-gray-800">Generate proxy links to content blocked on Twitter while preserving Twitter Card previews of the original content.<a href="#footnote"><sup class="font-semibold underline">*</sup></a></p>
    <div class="mb-4 shadow-lg p-6 bg-white">
      <div class="mb-4">
        <label for="url" class="block text-sm font-semibold text-gray-800 mb-2">Enter URL:</label>
        <input id="url" type="text" class="w-full border rounded-md px-3 py-2" />
      </div>
      <button id="generate" class="bg-blue-500 text-white px-4 py-2 rounded-md mb-4">Generate</button>
      <div class="mb-4">
        <label for="generatedUrl" class="block text-sm font-semibold text-gray-800 mb-2">Generated URL:</label>
        <input id="generatedUrl" type="text" class="w-full border rounded-md px-3 py-2" readonly />
      </div>
      <button id="copy" class="bg-gray-300 text-gray-600 px-4 py-2 rounded-md cursor-not-allowed" disabled>Copy</button>
      <span id="successMessage" class="ml-4 text-green-500 hidden">Copied!</span>
    </div>
    <p class="mb-4 text-gray-500 text-sm" id="footnote">
      * Except the card preview's domain name will be <code class="font-mono">twitter-cloak.gorgon.cc</code> instead of the original domain name. Card preview content is cached for 5 minutes.
    </p>
  </div>
  <script>
    const urlInput = document.getElementById('url');
    const generateButton = document.getElementById('generate');
    const generatedUrlInput = document.getElementById('generatedUrl');
    const copyButton = document.getElementById('copy');
    const successMessage = document.getElementById('successMessage');

    function updateGeneratedUrl() {
      const url = urlInput.value;
      const encodedUrl = btoa(url);
      generatedUrlInput.value = \`https://twitter-cloak.gorgon.cc/?url=\${encodedUrl}\`;
    }

    function enableCopyButton() {
      copyButton.classList.remove('bg-gray-300', 'text-gray-600', 'cursor-not-allowed');
      copyButton.classList.add('bg-blue-500', 'text-white', 'cursor-pointer');
      copyButton.disabled = false;
    }

    generateButton.addEventListener('click', () => {
      updateGeneratedUrl();
      enableCopyButton();
    });

    copyButton.addEventListener('click', () => {
      generatedUrlInput.select();
      document.execCommand('copy');
      successMessage.classList.remove('hidden');
      setTimeout(() => {
        successMessage.classList.add('hidden');
      }, 2000);
    });
  </script>
</body>
</html>
`;

async function fetchAndCache(request) {
  const response = await fetch(request);
  const clonedResponse = response.clone();
  const cache = caches.default;
  const cachedResponse = new Response(await clonedResponse.text(), {
    headers: clonedResponse.headers,
  });
  await cache.put(request, cachedResponse);
  return response;
}

async function handleRequest(event) {
  const url = new URL(event.request.url);
  const base64UrlParam = url.searchParams.get('url');
  if (!base64UrlParam) {
    return new Response(template, { headers: { 'Content-Type': 'text/html' } });
  }

  const redirectUrl = atob(base64UrlParam);
  const userAgent = event.request.headers.get('User-Agent');

  if (!userAgent.includes('Twitterbot')) {
    return Response.redirect(redirectUrl);
  }

  const cache = caches.default;
  const request = new Request(redirectUrl, {
    headers: { 'User-Agent': userAgent },
  });
  const cachedResponse = await cache.match(request);

  let originalResponse;

  if (cachedResponse) {
    const currentTime = new Date().getTime();
    const cacheTime = new Date(cachedResponse.headers.get('date')).getTime();

    if (currentTime - cacheTime < CACHE_DURATION) {
      originalResponse = cachedResponse;
    }
  }

  if (!originalResponse) {
    originalResponse = await fetchAndCache(request);
  }

  const originalResponseText = await originalResponse.text();
  const root = parse(originalResponseText);
  const metaTags = root.querySelectorAll('meta[name^="twitter:"], meta[property^="og:"]');
  const metaTagsHTML = metaTags.map((tag) => tag.outerHTML).join('');

  const bodyContent = `<body>${metaTagsHTML}</body>`;
  return new Response(bodyContent, {
    headers: { 'Content-Type': 'text/html' },
  });
}

addEventListener('fetch', (event) => {
  if (event.request.method === 'GET') {
    event.respondWith(handleRequest(event));
  } else {
    event.respondWith(new Response(null, { status: 405, statusText: 'Method Not Allowed' }));
  }
});
