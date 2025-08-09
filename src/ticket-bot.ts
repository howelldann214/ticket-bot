// src/ticket-bot.ts

import { chromium } from 'playwright';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

function waitUntil(targetTime: Date): Promise<void> {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      const now = new Date();
      const delay = targetTime.getTime() - now.getTime();

      if (delay <= 0) {
        clearInterval(interval);
        console.log('[⏰] 指定時間已到，開始執行流程...');
        resolve();
      } else {
        const seconds = Math.floor(delay / 1000);
        process.stdout.write(`\r[⏳] 距離開始還有 ${seconds} 秒...   `);
      }
    }, 1000);
  });
}

(async () => {
  // 連線到已經登入的 Brave 瀏覽器
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('tixcraft.com')) || pages[0];

  console.log('[✓] 已連線到 Brave，當前網址：', page.url());

  // ✅ 等待到指定時間開始搶票流程
  const startTimeStr = process.env.START_TIME; // 例：2025-08-07 12:00:00
  if (!startTimeStr) {
    console.error('[❌] 請在 .env 設定 START_TIME，例如：START_TIME=2025-08-07 12:00:00');
    return;
  }

  const startTime = new Date(startTimeStr);
  await waitUntil(startTime);

  



  // ✅ 插入第二階段按鈕（button.btn-primary）處理
  try {
    console.log('[🚀] 嘗試前往最終購票頁面（button[data-href]）...');
    await page.waitForSelector('button.btn-primary[data-href]', { timeout: 5000 });

    const nextUrl = await page.$eval('button.btn-primary[data-href]', el => el.getAttribute('data-href'));

    if (nextUrl) {
      console.log(`[➡️] 導向購票頁面：${nextUrl}`);
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded' });
    } else {
      console.error('[❌] 找不到 data-href，無法繼續');
      await page.screenshot({ path: `screenshots/no-href-${Date.now()}.png` });
      return;
    }
  } catch (error) {
    console.error('[❌] 第二階段按鈕處理失敗：', error);
    await page.screenshot({ path: `screenshots/fail-stage2-${Date.now()}.png` });
    return;
  }
  try {
    const targetSeat = process.env.TARGET_SEAT ;
    console.log(`[🎯] 嘗試選取「${targetSeat}」...`);

    const targetText = targetSeat;
    const target = await page.locator(`text=${targetText}`);
    await target.waitFor({ state: 'visible', timeout: 3000 });

    await target.click();
    console.log('[🟢] 成功點擊座位區域');

  } catch (error) {
    console.error('[❌] 找不到指定的座位區域或點擊失敗：', error);
    await page.screenshot({ path: `screenshots/seat-fail-${Date.now()}.png` });
    return;
  }
  
  try {
    const targetQuantity = process.env.TARGET_QUANTITY || '1';
    console.log(`[🎫] 嘗試選擇 ${targetQuantity} 張票...`);

    const selects = await page.locator('select.form-select').elementHandles();

    if (selects.length > 0) {
      await selects[0].selectOption(targetQuantity);
      console.log(`[🟢] 成功選擇 ${targetQuantity} 張票`);
    } else {
      console.error('[❌] 找不到票數下拉選單');
      await page.screenshot({ path: `screenshots/select-fail-${Date.now()}.png` });
    }
  } catch (error) {
    console.error('[❌] 選票數失敗：', error);
    await page.screenshot({ path: `screenshots/select-error-${Date.now()}.png` });
  }
  
  try {
  console.log('[🔍] 檢查是否出現驗證碼圖片...');
  const captchaImg = page.locator('img[src*="captcha"]');

  if (await captchaImg.count() > 0) {
    console.log('[🖼️] 發現驗證碼圖片，準備擷取並儲存 screenshots/captcha.png...');
    await captchaImg.screenshot({ path: 'screenshots/captcha.png' });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const verifyCode: string = await new Promise((resolve) => {
      rl.question('[🧠] 請查看 captcha.png 並輸入驗證碼：', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    const captchaInput = page.locator('input[placeholder*="驗證碼"]');
    await captchaInput.fill(verifyCode);
    console.log('[✅] 驗證碼已填入');
  } else {
    console.log('[ℹ️] 沒有驗證碼，跳過驗證碼處理');
  }
} catch (error) {
  console.error('[❌] 驗證碼處理失敗：', error);
  await page.screenshot({ path: `screenshots/captcha-error-${Date.now()}.png` });
  return;
}

try {
  console.log('[☑️] 嘗試勾選同意條款...');

  const checkboxLabel = await page.locator('text=我已詳細閱讀且同意').first();
  const checkbox = await checkboxLabel.locator('xpath=preceding::input[@type="checkbox"][1]');

  await checkbox.check();
  console.log('[🟢] 已成功勾選同意條款');
} catch (error) {
  console.error('[❌] 勾選條款失敗：', error);
  await page.screenshot({ path: `screenshots/checkbox-error-${Date.now()}.png` });
  return;
}

try {
  console.log('[🚀] 嘗試點擊「確認張數」按鈕...');

  const confirmBtn = page.locator('text=確認張數');
  await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });

  await confirmBtn.click();
  console.log('[🟢] 已成功點擊「確認張數」按鈕');
} catch (error) {
  console.error('[❌] 點擊「確認張數」失敗：', error);
  await page.screenshot({ path: `screenshots/confirm-error-${Date.now()}.png` });
  return;
}

  // browser.close(); // 不要關閉，手動控制
})();
