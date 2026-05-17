import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:3000/admin';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ isSuperAdmin: true, firstName: 'Test', lastName: 'Admin' }));
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(500);

const before = await page.evaluate(() => ({
  hasSnackbar: typeof globalThis.showSnackbar === 'function',
  hasShowPageToast: typeof globalThis.showPageToast === 'function',
  toastExists: !!document.getElementById('c360-toast'),
  readyState: document.readyState,
}));

await page.evaluate(() => {
  if (typeof globalThis.showSnackbar === 'function') {
    globalThis.showSnackbar('Toast de prueba automatizada', 'success');
  } else if (typeof globalThis.showPageToast === 'function') {
    globalThis.showPageToast('Toast de prueba automatizada', 'success');
  } else {
    throw new Error('showSnackbar/showPageToast no definidos');
  }
});

await page.waitForTimeout(300);

const after = await page.evaluate(() => {
  const el = document.getElementById('c360-toast');
  if (!el) return { error: 'sin #c360-toast' };
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    className: el.className,
    hiddenClass: el.classList.contains('hidden'),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    zIndex: style.zIndex,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    parent: el.parentElement?.tagName,
    text: document.getElementById('c360-toast-text')?.textContent,
    inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0,
  };
});

console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
