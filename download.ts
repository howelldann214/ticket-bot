
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const TARGET_URL = 'https://webbboxx.com/';
const DOWNLOAD_DIR = 'C:/code/ticket_bot/captcha_lab/samples';

async function runCrawler(page: any) {
  // 進入目標網站
  await page.goto(TARGET_URL);
  console.log('[✓] 已進入', TARGET_URL);

  // 點擊 Start Test 按鈕
  await page.click('button.start');
  console.log('[✓] 已點擊 Start Test');

  while (true) {
    // 檢查 timer 是否為 00:00
    const timerText = await page.$eval('#timer', (el: { textContent: string; }) => el.textContent?.trim() ?? '');
    if (timerText === '00:00') {
      console.log('計時器已結束，停止操作');
      break;
    }

    // 等待 captcha-container 出現
    await page.waitForSelector('.captcha-container img');
    const imgElement = await page.$('.captcha-container img');
    if (!imgElement) {
      console.log('找不到 captcha 圖片');
      break;
    }

    // 取得 src 屬性
    const src = await imgElement.getAttribute('src');
    if (!src) {
      console.log('找不到圖片 src');
      break;
    }

    // 從 src 取得 text=xxx
    const match = src.match(/text=([a-zA-Z0-9]{4})/);
    if (!match) {
      console.log('src 無 text=xxxx');
      break;
    }
    const answer = match[1];

    // 下載圖片
    const imgUrl = new URL(src, TARGET_URL).toString();
    const imgBuffer = await page.evaluate(async (imgUrl: string | URL | Request) => {
      const res = await fetch(imgUrl);
      const buf = await res.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    }, imgUrl);
    const filePath = path.join(DOWNLOAD_DIR, `${answer}.png`);
    fs.writeFileSync(filePath, Buffer.from(imgBuffer));
    console.log(`[✓] 已下載 ${filePath}`);

    // 輸入答案並送出
    await page.fill('#captchaInput', answer);
    await page.keyboard.press('Enter');
    console.log(`[✓] 已輸入並送出答案: ${answer}`);

    // 等待新一輪 captcha 出現
    await page.waitForTimeout(1000);
  }
}

function askContinue(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question('要再跑一次嗎？(Y/N): ', answer => {
      rl.close();
      resolve(answer.trim().toUpperCase() === 'Y');
    });
  });
}

// 主程式入口
(async () => {
  // 連線到已經登入的 Brave 瀏覽器 (IPv4)
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9220');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  do {
    await runCrawler(page);
  } while (await askContinue());

  await browser.close();
  console.log('已完成所有操作');
})();