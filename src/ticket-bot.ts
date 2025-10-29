// src/ticket-bot.ts

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

  // 指定時間到後，刷新頁面
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('[🔄] 頁面已刷新');

  



  // ✅ 插入第二階段按鈕（button.btn-primary）處理
  try {
    console.log('[🚀] 嘗試前往最終購票頁面（button[data-href]）...');
    await page.waitForSelector('button.btn-primary[data-href]', { timeout: 5000 });

    const nextUrl = await page.locator('button.btn-primary[data-href]').nth(0).getAttribute('data-href');

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
    const targetSeat = process.env.TARGET_NAME ;
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

      const screenshotsDir = path.join(process.cwd(), 'screenshots');
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
      const outPath = path.join(screenshotsDir, 'captcha.png');

      await captchaImg.screenshot({ path: outPath });

      // 自動呼叫本機 OCR server，填入 captcha（但不按送出）
      try {
        const apiUrl = 'http://127.0.0.1:5001/ocr';
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: outPath }),
        });

        if (!res.ok) {
          const text = await res.text();
          console.error('[❌] OCR server 回傳錯誤：', res.status, text);
          console.log('[ℹ️] 無法自動辨識，儲存 captcha 圖片供人工檢查：', outPath);
        } else {
          const data = await res.json();
          const items = data && data.items && Array.isArray(data.items) ? data.items : [];
          const firstFormatted = items.find((it: any) => it && it.formatted && String(it.formatted).trim().length > 0);
          if (firstFormatted) {
            const formattedValue = String(firstFormatted.formatted).trim();
            const captchaInput = page.locator('input[placeholder*="驗證碼"]');
            // 填入 input 並觸發 input/change
            await captchaInput.fill(formattedValue);
            await captchaInput.evaluate((el, v) => {
              (el as HTMLInputElement).value = v;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, formattedValue);
            console.log(`[✓] 已將 OCR 結果填入 captcha 欄位（尚未送出）：${formattedValue}`);
          } else {
            console.log('[ℹ] OCR 未回傳 formatted 值，未自動填入');
            console.log('[ℹ] 儲存 captcha 圖片供人工檢查：', outPath);
          }
        }
      } catch (err) {
        console.error('[❌] 無法連線至 OCR server，請確認你已啟動 OCR/ocr_server.py：', err);
        console.log('[ℹ] 儲存 captcha 圖片供人工檢查：', outPath);
      }

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
